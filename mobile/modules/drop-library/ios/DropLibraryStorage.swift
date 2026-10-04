import Foundation
import ImageIO
import UIKit

enum DropLibraryStorageError: Error {
  case invalidIdentifier
  case invalidSource
  case invalidManagedPath
  case missingFile
  case invalidImage
}

public final class DropLibraryStorage {
  private let manager: FileManager
  public let root: URL
  public let media: URL
  public let artwork: URL
  private let cache: URL

  public init(manager: FileManager = .default) throws {
    self.manager = manager
    guard let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
          let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw DropLibraryStorageError.invalidSource
    }
    self.cache = cache.standardizedFileURL.resolvingSymlinksInPath()
    root = support.standardizedFileURL.resolvingSymlinksInPath()
      .appendingPathComponent("Drop", isDirectory: true)
    media = root.appendingPathComponent("Media", isDirectory: true)
    artwork = root.appendingPathComponent("Artwork", isDirectory: true)
    for directory in [root, media, artwork] {
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard values.isDirectory == true, values.isSymbolicLink != true,
            directory.resolvingSymlinksInPath() == directory.standardizedFileURL else {
        throw DropLibraryStorageError.invalidManagedPath
      }
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

  func relativeCachePath(for uri: String) throws -> (String, String, Int64) {
    guard let url = URL(string: uri), url.isFileURL else {
      throw DropLibraryStorageError.invalidSource
    }
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
    let relative = String(resolved.path.dropFirst(cache.path.count + 1))
    guard resolved.path.hasPrefix(cache.path + "/"),
          isOwnedCachePath(relative),
          let size = try regularSize(resolved), size > 0 else {
      throw DropLibraryStorageError.invalidSource
    }
    return (relative, try Self.validatedExtension(resolved.pathExtension), size)
  }

  func isOwnedCachePath(_ relative: String) -> Bool {
    DropLibraryPaths.ownedCachePath(relative)
  }

  func moveFromCache(relative: String, id: String, ext: String) throws -> (URL, Int64) {
    let validID = try Self.validatedID(id)
    let validExt = try Self.validatedExtension(ext)
    guard isOwnedCachePath(relative),
          URL(fileURLWithPath: relative).pathExtension.lowercased() == validExt else {
      throw DropLibraryStorageError.invalidSource
    }
    let source = cache.appendingPathComponent(relative).standardizedFileURL
    guard source.path.hasPrefix(cache.path + "/"),
          source.resolvingSymlinksInPath() == source,
          let sourceSize = try regularSize(source), sourceSize > 0 else {
      throw DropLibraryStorageError.invalidSource
    }
    let destination = media.appendingPathComponent("\(validID).\(validExt)")
    guard !manager.fileExists(atPath: destination.path) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    try manager.moveItem(at: source, to: destination)
    if relative.hasPrefix("MediaDrop/") {
      let workspace = source.deletingLastPathComponent()
      if (try? manager.contentsOfDirectory(atPath: workspace.path).isEmpty) == true {
        try? manager.removeItem(at: workspace)
      }
    }
    guard let destinationSize = try regularSize(destination), destinationSize == sourceSize else {
      throw DropLibraryStorageError.missingFile
    }
    return (destination, destinationSize)
  }

  func removeOwnedCache(relative: String) throws {
    guard isOwnedCachePath(relative) else { throw DropLibraryStorageError.invalidSource }
    let url = cache.appendingPathComponent(relative).standardizedFileURL
    guard url.path.hasPrefix(cache.path + "/"), url.resolvingSymlinksInPath() == url else {
      throw DropLibraryStorageError.invalidSource
    }
    if try regularSize(url) != nil { try manager.removeItem(at: url) }
  }

  public func managedMedia(relative: String) throws -> (URL, Int64)? {
    guard DropLibraryPaths.managedMediaPath(relative),
          let name = relative.split(separator: "/").last else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    let url = media.appendingPathComponent(String(name))
    guard let size = try regularSize(url) else { return nil }
    return (url, size)
  }

  func managedArtwork(id: String) throws -> (URL, Int64)? {
    let url = artwork.appendingPathComponent("\(try Self.validatedID(id)).jpg")
    guard let size = try regularSize(url) else { return nil }
    guard size > 0, size <= 2 * 1_048_576,
          let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          CGImageSourceGetCount(source) > 0,
          CGImageSourceGetStatusAtIndex(source, 0) == .statusComplete else {
      try manager.removeItem(at: url)
      return nil
    }
    return (url, size)
  }

  func removeMedia(relative: String) throws {
    if let (url, _) = try managedMedia(relative: relative) { try manager.removeItem(at: url) }
  }

  func removeArtwork(id: String) throws {
    if let (url, _) = try managedArtwork(id: id) { try manager.removeItem(at: url) }
  }

  func mediaFiles() throws -> [String] {
    try manager.contentsOfDirectory(at: media, includingPropertiesForKeys: nil)
      .compactMap { url in
        let relative = "Media/\(url.lastPathComponent)"
        return (try? managedMedia(relative: relative)) != nil ? relative : nil
      }
  }

  func artworkFiles() throws -> [String] {
    try manager.contentsOfDirectory(at: artwork, includingPropertiesForKeys: nil)
      .compactMap { url in
        guard url.pathExtension.lowercased() == "jpg",
              let id = try? Self.validatedID(url.deletingPathExtension().lastPathComponent),
              (try? managedArtwork(id: id)) != nil else {
          // Artwork is an owned directory. Remove only regular files, not links or directories.
          if (try? regularSize(url)) != nil { try? manager.removeItem(at: url) }
          return nil
        }
        return id
      }
  }

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

  private func regularSize(_ url: URL) throws -> Int64? {
    guard manager.fileExists(atPath: url.path) else { return nil }
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true,
          url.resolvingSymlinksInPath() == url.standardizedFileURL else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    return Int64(values.fileSize ?? 0)
  }
}
