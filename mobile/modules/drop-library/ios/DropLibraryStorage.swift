import Darwin
import Foundation
#if canImport(UIKit)
import ImageIO
import UIKit
#endif

public final class DropLibraryStorage {
  private let manager: FileManager
  public let root: URL
  public let media: URL
  public let artwork: URL
  let importedMedia: URL
  private let cache: URL
  private var staging: URL { cache.appendingPathComponent("DropImport", isDirectory: true) }

  public convenience init(manager: FileManager = .default) throws {
    guard let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
          let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw DropLibraryStorageError.invalidSource
    }
    try self.init(supportDirectory: support, cacheDirectory: cache, manager: manager)
  }

  init(supportDirectory support: URL, cacheDirectory cache: URL, manager: FileManager = .default) throws {
    guard DropLibraryPaths.isUnredirected(support), DropLibraryPaths.isUnredirected(cache) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    self.manager = manager
    self.cache = cache.standardizedFileURL.resolvingSymlinksInPath()
    root = support.standardizedFileURL.resolvingSymlinksInPath()
      .appendingPathComponent("Drop", isDirectory: true)
    media = root.appendingPathComponent("Media", isDirectory: true)
    artwork = root.appendingPathComponent("Artwork", isDirectory: true)
    importedMedia = root.appendingPathComponent("ImportedMedia", isDirectory: true)
    for directory in [root, media, artwork, importedMedia] {
      try ensureDirectory(directory)
    }
    // Downloads are large and reproducible; SQLite metadata remains backed up.
    for directory in [media, artwork] {
      var url = directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }
  }

  static func validatedID(_ id: String) throws -> String {
    guard let valid = DropLibraryPaths.identifier(id) else {
      throw DropLibraryStorageError.invalidIdentifier
    }
    return valid
  }

  static func validatedExtension(_ value: String) throws -> String {
    guard let lower = DropLibraryPaths.fileExtension(value) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    return lower
  }

  struct Prepared {
    let id: String
    let cacheRelativePath: String
    let ext: String
    let size: Int64
    let relativeMediaPath: String
  }

  func inspectSource(uri: String, origin: String) throws -> Prepared {
    guard let folder = DropLibraryPaths.MediaFolder(origin: origin),
          let url = URL(string: uri), url.isFileURL, (url.host ?? "").isEmpty else {
      throw DropLibraryStorageError.invalidSource
    }
    let path = DropLibraryPaths.systemPath(url.path)
    let prefix = DropLibraryPaths.systemPath(cache.path) + "/"
    guard path.hasPrefix(prefix) else { throw DropLibraryStorageError.invalidSource }
    let relative = String(path.dropFirst(prefix.count))
    guard let (_, size) = try preparedSource(relative: relative), size > 0 else {
      throw DropLibraryStorageError.invalidSource
    }
    let ext = try Self.validatedExtension(url.pathExtension)
    let id = DropLibraryPaths.importedStagingID(relative) ?? UUID().uuidString.lowercased()
    let destination = try promotionDestination(relative: relative, id: id, ext: ext, folder: folder)
    return Prepared(id: id, cacheRelativePath: relative, ext: ext, size: size, relativeMediaPath: destination)
  }

  private func promotionDestination(relative: String, id: String, ext: String,
                                    folder: DropLibraryPaths.MediaFolder) throws -> String {
    let validID = try Self.validatedID(id)
    let validExt = try Self.validatedExtension(ext)
    let importedID = DropLibraryPaths.importedStagingID(relative)
    guard DropLibraryPaths.ownedCachePath(relative), folder.accepts(validExt),
          URL(fileURLWithPath: relative).pathExtension.lowercased() == validExt,
          folder == .imported ? importedID == validID : importedID == nil else {
      throw DropLibraryStorageError.invalidSource
    }
    return "\(folder.rawValue)/\(validID).\(validExt)"
  }

  func moveFromCache(relative: String, id: String, ext: String, origin: String,
                     expectedSize: Int64, expectedPath: String) throws -> (String, URL, Int64) {
    guard let folder = DropLibraryPaths.MediaFolder(origin: origin) else {
      throw DropLibraryStorageError.invalidSource
    }
    let path = try promotionDestination(relative: relative, id: id, ext: ext, folder: folder)
    guard path == expectedPath,
          let (source, sourceSize) = try preparedSource(relative: relative),
          sourceSize > 0, sourceSize == expectedSize else {
      throw DropLibraryStorageError.invalidSource
    }
    let destination = root.appendingPathComponent(path)
    guard DropLibraryPaths.isUnredirected(destination),
          try regularSize(destination) == nil else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    if folder == .imported {
      // The same-volume rename needs no second media copy. Leave room for SQLite and app writes.
      guard let available = try Self.availableCapacity(at: importedMedia), available >= 1_073_741_824 else {
        throw DropLibraryStorageError.insufficientSpace
      }
      try checkImportBackupLocation()
      try allowBackup(source)
      // An exclusive rename either succeeds on this volume or leaves the staged copy in place.
      guard renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
    } else {
      try manager.moveItem(at: source, to: destination)
    }
    if relative.hasPrefix("MediaDrop/") || folder == .imported {
      removeEmptyWorkspace(source.deletingLastPathComponent())
    }
    guard let destinationSize = try regularSize(destination), destinationSize == expectedSize else {
      throw DropLibraryStorageError.missingFile
    }
    if folder == .imported { try allowBackup(destination) }
    return (path, destination, destinationSize)
  }

  func confirmImported(relative: String, id: String, size: Int64, mediaType: String) async throws {
    guard DropLibraryPaths.managedMediaFolder(relative) == .imported,
          let (url, actual) = try managedMedia(relative: relative), actual == size, size > 0,
          url.deletingPathExtension().lastPathComponent == id else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    let metadata = try await DropLocalMediaInspection.inspect(url)
    guard metadata.mediaType == mediaType, try regularSize(url) == size else {
      throw DropLibraryStorageError.invalidSource
    }
    try checkImportBackupLocation()
    try allowBackup(url)
  }

  private func ensureDirectory(_ directory: URL) throws {
    guard DropLibraryPaths.isUnredirected(directory) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true,
          DropLibraryPaths.isUnredirected(directory) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
  }

  private func checkImportBackupLocation() throws {
    let support = root.deletingLastPathComponent()
    for directory in [support.deletingLastPathComponent(), support, root, importedMedia] {
      guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup != true else {
        throw DropLibraryStorageError.backupExcluded
      }
    }
  }

  private func allowBackup(_ file: URL) throws {
    var url = file
    var values = URLResourceValues()
    values.isExcludedFromBackup = false
    try url.setResourceValues(values)
    // Read via a fresh URL to avoid a cached resource value.
    let verified = try URL(fileURLWithPath: file.path).resourceValues(forKeys: [.isExcludedFromBackupKey])
    guard verified.isExcludedFromBackup == false else { throw DropLibraryStorageError.backupExcluded }
  }

  private func removeEmptyWorkspace(_ workspace: URL) {
    if (try? manager.contentsOfDirectory(atPath: workspace.path).isEmpty) == true {
      try? manager.removeItem(at: workspace)
    }
  }

  func removeOwnedCache(relative: String) throws {
    guard DropLibraryPaths.ownedCachePath(relative) else { throw DropLibraryStorageError.invalidSource }
    let url = cache.appendingPathComponent(relative).standardizedFileURL
    guard url.path.hasPrefix(cache.path + "/"), DropLibraryPaths.isUnredirected(url) else {
      throw DropLibraryStorageError.invalidSource
    }
    if try regularSize(url) != nil { try manager.removeItem(at: url) }
    if DropLibraryPaths.importedStagingID(relative) != nil {
      removeEmptyWorkspace(url.deletingLastPathComponent())
    }
  }

  public func managedMedia(relative: String) throws -> (URL, Int64)? {
    guard DropLibraryPaths.managedMediaPath(relative) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    let url = root.appendingPathComponent(relative)
    guard DropLibraryPaths.isUnredirected(url) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    guard let size = try regularSize(url) else { return nil }
    return (url, size)
  }

  public func managedArtwork(id: String) throws -> (URL, Int64)? {
    let url = artwork.appendingPathComponent("\(try Self.validatedID(id)).jpg")
    guard let size = try DropLibraryFileInspection.artworkSize(url, manager: manager) else { return nil }
    return (url, size)
  }

  func removeMedia(relative: String) throws {
    if let (url, _) = try managedMedia(relative: relative) { try manager.removeItem(at: url) }
  }

  func removeArtwork(id: String) throws {
    let url = artwork.appendingPathComponent("\(try Self.validatedID(id)).jpg")
    // Explicit deletion may remove an invalid regular image; inspection may not.
    if try regularSize(url) != nil { try manager.removeItem(at: url) }
  }

  func preparedSource(relative: String) throws -> (URL, Int64)? {
    guard DropLibraryPaths.ownedCachePath(relative) else { throw DropLibraryStorageError.invalidSource }
    let url = cache.appendingPathComponent(relative).standardizedFileURL
    guard url.path.hasPrefix(cache.path + "/"), DropLibraryPaths.isUnredirected(url) else {
      throw DropLibraryStorageError.invalidSource
    }
    guard let size = try regularSize(url) else { return nil }
    return (url, size)
  }

  func mediaFiles() throws -> [String] {
    try DropLibraryPaths.MediaFolder.allCases.flatMap { folder in
      let directory = root.appendingPathComponent(folder.rawValue, isDirectory: true)
      guard DropLibraryPaths.isUnredirected(directory) else {
        throw DropLibraryStorageError.invalidManagedPath
      }
      return try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        .compactMap { url in
          let relative = "\(folder.rawValue)/\(url.lastPathComponent)"
          return (try? managedMedia(relative: relative)) != nil ? relative : nil
        }
    }
  }

  // Called during startup reconciliation, before the picker can begin another import.
  func cleanupImportStaging(protected: [String]) throws {
    try ensureDirectory(staging)
    let protectedIDs = Set(protected.compactMap { DropLibraryPaths.importedStagingID($0) })
    for workspace in try manager.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil) {
      let id = workspace.lastPathComponent
      guard DropLibraryPaths.identifier(id) == id, !protectedIDs.contains(id),
            DropLibraryPaths.isUnredirected(workspace),
            try workspace.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { continue }
      let files = try manager.contentsOfDirectory(at: workspace, includingPropertiesForKeys: nil)
      for file in files {
        let path = "DropImport/\(id)/\(file.lastPathComponent)"
        if (DropLibraryPaths.importedStagingID(path) != nil ||
            DropLibraryPaths.importedStagingID(path, prefix: "partial") != nil),
           (try? regularSize(file)) != nil {
          try manager.removeItem(at: file)
        }
      }
      removeEmptyWorkspace(workspace)
    }
  }

  // Native callers must hold access to the selected URL for the duration of this operation.
  // The bridge accepts only the resulting sandbox URL and never opens a provider URL.
  func stageLocalFile(from source: URL,
                      capacity: @Sendable (URL) throws -> Int64? = { try DropLibraryStorage.availableCapacity(at: $0) })
    async throws -> (uri: String, title: String, mediaType: String, durationSeconds: Double) {
    try Task.checkCancellation()
    guard source.isFileURL, (source.host ?? "").isEmpty,
          let ext = DropLibraryPaths.fileExtension(source.pathExtension),
          DropLibraryPaths.MediaFolder.imported.accepts(ext) else { throw DropLibraryStorageError.invalidSource }
    try ensureDirectory(staging)
    let workspace = staging.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    try manager.createDirectory(at: workspace, withIntermediateDirectories: false)
    let partial = workspace.appendingPathComponent("partial.\(ext)")
    let prepared = workspace.appendingPathComponent("payload.\(ext)")
    var staged = false
    defer {
      if !staged {
        try? manager.removeItem(at: partial)
        removeEmptyWorkspace(workspace)
      }
    }

    var coordinationError: NSError?
    var copyResult: Result<Int64, Error>?
    NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
      copyResult = Result { try copyLocalFile(from: url, to: partial, capacity: capacity) }
    }
    if let coordinationError { throw coordinationError }
    guard let expectedSize = try copyResult?.get() else { throw DropLibraryStorageError.invalidSource }
    let metadata = try await DropLocalMediaInspection.inspect(partial)
    try Task.checkCancellation()
    guard try regularSize(partial) == expectedSize else { throw DropLibraryStorageError.invalidSource }
    try manager.moveItem(at: partial, to: prepared)
    staged = true
    return (prepared.absoluteString, source.deletingPathExtension().lastPathComponent,
            metadata.mediaType, metadata.durationSeconds)
  }

  private static func availableCapacity(at url: URL) throws -> Int64? {
    try url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage
  }

  private func copyLocalFile(from source: URL, to destination: URL,
                             capacity: @Sendable (URL) throws -> Int64?) throws -> Int64 {
    let parent = source.deletingLastPathComponent().standardizedFileURL
    let inputURL = parent.appendingPathComponent(source.lastPathComponent)
    guard let expected = try regularSize(inputURL), expected > 0 else {
      throw DropLibraryStorageError.invalidSource
    }
    let volume = destination.deletingLastPathComponent()
    guard let available = try capacity(volume) else { throw DropLibraryStorageError.insufficientSpace }
    let reserve = max(Int64(1_073_741_824), available / 10)
    guard available >= reserve, expected <= available - reserve else {
      throw DropLibraryStorageError.insufficientSpace
    }
    let descriptor = Darwin.open(inputURL.path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    let reader = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? reader.close() }
    let outputDescriptor = Darwin.open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard outputDescriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    let writer = FileHandle(fileDescriptor: outputDescriptor, closeOnDealloc: true)
    defer { try? writer.close() }
    var copied: Int64 = 0
    while let bytes = try reader.read(upToCount: 1_048_576), !bytes.isEmpty {
      try Task.checkCancellation()
      guard Int64(bytes.count) <= expected - copied else { throw DropLibraryStorageError.invalidSource }
      guard let remaining = try capacity(volume), remaining >= reserve,
            Int64(bytes.count) <= remaining - reserve else {
        throw DropLibraryStorageError.insufficientSpace
      }
      try writer.write(contentsOf: bytes)
      copied += Int64(bytes.count)
    }
    try writer.synchronize()
    try writer.close()
    guard copied == expected, try regularSize(inputURL) == expected,
          try regularSize(destination) == expected else { throw DropLibraryStorageError.invalidSource }
    return expected
  }

  func artworkFiles() throws -> [String] {
    try DropLibraryFileInspection.artworkIDs(in: artwork, manager: manager)
  }

  #if canImport(UIKit)
  func saveJPEG(_ data: Data, id: String) throws -> (URL, Int64) {
    guard data.count > 0, data.count <= 2 * 1_048_576,
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 4096, height <= 4096,
          width * height <= 16_000_000,
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 512,
            kCGImageSourceCreateThumbnailWithTransform: true
          ] as CFDictionary),
          let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.82),
          jpeg.count <= 2 * 1_048_576 else {
      throw DropLibraryStorageError.invalidImage
    }
    let url = artwork.appendingPathComponent("\(try Self.validatedID(id)).jpg")
    try jpeg.write(to: url, options: .atomic)
    return (url, Int64(jpeg.count))
  }

  #endif

  private func regularSize(_ url: URL) throws -> Int64? {
    try DropLibraryFileInspection.regularSize(url, manager: manager)
  }
}
