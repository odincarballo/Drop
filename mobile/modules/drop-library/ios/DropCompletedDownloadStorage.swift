import CryptoKit
import Darwin
import Foundation

struct DropCompletedDownloadAsset: Equatable {
  let id: String
  let ext: String
  let sizeBytes: Int64
  let sha256: String

  var filename: String { "\(id)-\(sha256).\(ext)" }
  var relativeMediaPath: String { "Media/\(id).\(ext)" }
  var payload: [String: Any] {
    ["id": id, "ext": ext, "sizeBytes": sizeBytes, "sha256": sha256]
  }

  var valid: Bool {
    DropLibraryPaths.identifier(id) == id && DropLibraryPaths.fileExtension(ext) == ext &&
      sizeBytes > 0 && Self.isHexDigest(sha256)
  }

  static func isHexDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }
}

private struct DownloadFileSnapshot: Equatable {
  let identity: String
  let size: off_t
  let modified: timespec
  let changed: timespec

  init(_ info: stat) throws {
    guard (info.st_mode & S_IFMT) == S_IFREG, info.st_nlink == 1, info.st_size > 0 else {
      throw DropLibraryStorageError.invalidSource
    }
    identity = "\(info.st_dev):\(info.st_ino):\(info.st_birthtimespec.tv_sec):\(info.st_birthtimespec.tv_nsec)"
    size = info.st_size
    modified = info.st_mtimespec
    changed = info.st_ctimespec
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.sealedIdentity == rhs.sealedIdentity &&
      lhs.changed.tv_sec == rhs.changed.tv_sec && lhs.changed.tv_nsec == rhs.changed.tv_nsec
  }

  // Renaming changes ctime. Birth time, inode, size and mtime follow the object.
  var sealedIdentity: String {
    "\(identity):\(size):\(modified.tv_sec):\(modified.tv_nsec)"
  }
}

private struct DownloadPublicationLease {
  let url: URL
  let snapshot: DownloadFileSnapshot
}

// All Drop mutations of these paths use this lock. Expo calls retain the
// destination lease across the independent JS SQLite transaction.
private final class DownloadFileOwnership: @unchecked Sendable {
  let lock = NSLock()
  var leases: [String: DownloadPublicationLease] = [:]
}

private let downloadFiles = DownloadFileOwnership()
private let downloadSealAttribute = "com.odincarballo.drop.download-seal"

extension DropLibraryStorage {
  func stageCompletedDownload(key: String, uri: String, origin: String, owner: String,
                              size: Int64, mediaType: String) async throws -> DropCompletedDownloadAsset {
    let relative = try cacheRelativePath(for: uri)
    let owned = origin == "direct"
      ? owner.utf8.count == 32 && owner.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } &&
        relative.hasPrefix("mediadrop-\(owner)-") && !relative.contains("/")
      : origin == "youtube" && DropLibraryPaths.identifier(owner) != nil &&
        relative.hasPrefix("MediaDrop/\(owner)/")
    guard owned, let (source, actual) = try preparedSource(relative: relative),
          actual == size, size > 0 else { throw DropLibraryStorageError.invalidSource }

    let ext = try Self.validatedExtension(source.pathExtension)
    let before = try completedDownloadSnapshot(source)
    try await DropLocalMediaInspection.inspectCompletedDownload(source, mediaType: mediaType)
    return try downloadFiles.lock.withLock {
      let workspace = try downloadWorkspace(key)
      try ensureDirectory(workspace)
      var staging = workspace.deletingLastPathComponent()
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try staging.setResourceValues(values)
      guard try downloadStage(key) == nil else {
        throw DropLibraryStorageError.invalidManagedPath
      }
      return try withDownloadFile(source) { handle, snapshot in
        guard snapshot == before else { throw DropLibraryStorageError.invalidSource }
        let asset = DropCompletedDownloadAsset(id: UUID().uuidString.lowercased(), ext: ext,
          sizeBytes: size, sha256: try completedDownloadDigest(handle, size: size))
        try Task.checkCancellation()
        guard try completedDownloadSnapshot(source) == snapshot else {
          throw DropLibraryStorageError.invalidSource
        }
        let stamp = downloadSeal(key, asset, snapshot)
        let result = stamp.withUnsafeBytes {
          fsetxattr(handle.fileDescriptor, downloadSealAttribute, $0.baseAddress, $0.count, 0, XATTR_CREATE)
        }
        guard result == 0 else { throw downloadFileError() }
        let destination = workspace.appendingPathComponent(asset.filename)
        try renameCompletedDownload(source, to: destination)
        guard try sealedDownloadSnapshot(destination, key: key, asset: asset).sealedIdentity ==
                snapshot.sealedIdentity else {
          throw DropLibraryStorageError.invalidSource
        }
        if origin == "youtube" { _ = rmdir(source.deletingLastPathComponent().path) }
        return asset
      }
    }
  }

  func findCompletedDownload(key: String, size: Int64) throws -> DropCompletedDownloadAsset? {
    try downloadFiles.lock.withLock {
      guard let (asset, file) = try downloadStage(key) else { return nil }
      guard asset.sizeBytes == size else { throw DropLibraryStorageError.invalidSource }
      _ = try sealedDownloadSnapshot(file, key: key, asset: asset)
      return asset
    }
  }

  func placeCompletedDownload(key: String, asset: DropCompletedDownloadAsset, move: Bool) throws -> String {
    guard asset.valid else { throw DropLibraryStorageError.invalidSource }
    let destination = root.appendingPathComponent(asset.relativeMediaPath)
    return try withUnleasedDownloadPath(destination) {
      let existing = try managedMedia(relative: asset.relativeMediaPath)
      if let (staged, source) = try downloadStage(key) {
        guard move, existing == nil, staged == asset else {
          throw DropLibraryStorageError.invalidSource
        }
        let stagedSnapshot = try sealedDownloadSnapshot(source, key: key, asset: asset)
        try renameCompletedDownload(source, to: destination)
        guard try completedDownloadSnapshot(destination).sealedIdentity == stagedSnapshot.sealedIdentity else {
          throw DropLibraryStorageError.invalidSource
        }
        _ = rmdir(source.deletingLastPathComponent().path)
      } else if existing == nil {
        throw DropLibraryStorageError.invalidSource
      }

      let snapshot = try verifiedDownloadSnapshot(destination, key: key, asset: asset)
      let token = UUID().uuidString
      downloadFiles.leases[token] = DownloadPublicationLease(url: destination, snapshot: snapshot)
      return token
    }
  }

  static func verifyCompletedDownload(token: String) throws {
    try downloadFiles.lock.withLock {
      guard let lease = downloadFiles.leases[token],
            try completedDownloadSnapshot(lease.url) == lease.snapshot else {
        throw DropLibraryStorageError.invalidSource
      }
    }
  }

  static func releaseCompletedDownload(token: String) {
    downloadFiles.lock.withLock { _ = downloadFiles.leases.removeValue(forKey: token) }
  }

  func withUnleasedDownloadPath<T>(_ url: URL, _ action: () throws -> T) throws -> T {
    try downloadFiles.lock.withLock {
      guard !downloadFiles.leases.values.contains(where: { $0.url.path == url.path }) else {
        throw DropLibraryStorageError.invalidManagedPath
      }
      return try action()
    }
  }

  func discardCompletedDownload(key: String, asset: DropCompletedDownloadAsset) throws {
    guard asset.valid else { throw DropLibraryStorageError.invalidSource }
    try downloadFiles.lock.withLock {
      let workspace = try downloadWorkspace(key)
      let quarantined = workspace.appendingPathComponent(".discard")
      let staged = try downloadStage(key)
      if try downloadFileExists(quarantined) {
        // Reopen after an interruption between quarantine and unlink.
        guard staged == nil else { throw DropLibraryStorageError.invalidSource }
        _ = try verifiedDownloadSnapshot(quarantined, key: key, asset: asset)
      } else {
        guard let (candidate, file) = staged else { return }
        guard candidate == asset else { throw DropLibraryStorageError.invalidSource }
        _ = try sealedDownloadSnapshot(file, key: key, asset: asset)
        try renameCompletedDownload(file, to: quarantined)
        do {
          _ = try verifiedDownloadSnapshot(quarantined, key: key, asset: asset)
        } catch {
          // An unexpected object must survive. Restore its name only if free.
          try? renameCompletedDownload(quarantined, to: file)
          throw error
        }
      }
      // Only this locked protocol can mutate quarantine. unlink is never recursive.
      guard unlink(quarantined.path) == 0 else { throw downloadFileError() }
      _ = rmdir(workspace.path)
    }
  }

  private func downloadWorkspace(_ key: String) throws -> URL {
    let parts = key.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 2, (1...64).contains(parts[0].utf8.count),
          parts[0].utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) || $0 == 45 }),
          let generation = Int(parts[1]), generation > 0, String(generation) == parts[1] else {
      throw DropLibraryStorageError.invalidIdentifier
    }
    let url = root.appendingPathComponent("DownloadStaging", isDirectory: true)
      .appendingPathComponent(key, isDirectory: true)
    guard DropLibraryPaths.isUnredirected(url) else { throw DropLibraryStorageError.invalidManagedPath }
    return url
  }

  private func downloadStage(_ key: String) throws -> (DropCompletedDownloadAsset, URL)? {
    let workspace = try downloadWorkspace(key)
    let manager = FileManager.default
    let files: [URL]
    do {
      files = try manager.contentsOfDirectory(at: workspace, includingPropertiesForKeys: nil)
    } catch {
      let cause = error as NSError
      if cause.domain == NSCocoaErrorDomain &&
          (cause.code == NSFileReadNoSuchFileError || cause.code == NSFileNoSuchFileError) { return nil }
      throw error
    }
    var found: (DropCompletedDownloadAsset, URL)?
    for file in files {
      let name = file.deletingPathExtension().lastPathComponent
      guard name.utf8.count == 101, name.dropFirst(36).first == "-",
            let id = DropLibraryPaths.identifier(String(name.prefix(36))),
            id == name.prefix(36), let ext = DropLibraryPaths.fileExtension(file.pathExtension),
            ext == file.pathExtension else { continue }
      let hash = String(name.dropFirst(37))
      guard DropCompletedDownloadAsset.isHexDigest(hash) else { continue }
      guard found == nil, let size = try DropLibraryFileInspection.regularSize(file) else {
        throw DropLibraryStorageError.invalidManagedPath
      }
      found = (DropCompletedDownloadAsset(id: id, ext: ext, sizeBytes: size, sha256: hash), file)
    }
    return found
  }

  private func renameCompletedDownload(_ source: URL, to destination: URL) throws {
    guard DropLibraryPaths.isUnredirected(source), DropLibraryPaths.isUnredirected(destination) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    guard renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) == 0 else {
      throw downloadFileError()
    }
  }

}

private func downloadFileError() -> POSIXError {
  POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
}

private func downloadFileExists(_ url: URL) throws -> Bool {
  var info = stat()
  if lstat(url.path, &info) == 0 { return true }
  if errno == ENOENT { return false }
  throw downloadFileError()
}

private func completedDownloadSnapshot(_ url: URL) throws -> DownloadFileSnapshot {
  var info = stat()
  guard DropLibraryPaths.isUnredirected(url), lstat(url.path, &info) == 0 else {
    throw DropLibraryStorageError.invalidSource
  }
  return try DownloadFileSnapshot(info)
}

private func withDownloadFile<T>(_ url: URL, _ action: (FileHandle, DownloadFileSnapshot) throws -> T) throws -> T {
  let before = try completedDownloadSnapshot(url)
  let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  guard descriptor >= 0 else { throw downloadFileError() }
  let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
  defer { try? handle.close() }
  var info = stat()
  guard fstat(descriptor, &info) == 0, try DownloadFileSnapshot(info) == before else {
    throw DropLibraryStorageError.invalidSource
  }
  return try action(handle, before)
}

private func downloadSeal(_ key: String, _ asset: DropCompletedDownloadAsset, _ snapshot: DownloadFileSnapshot) -> Data {
  Data("\(key):\(asset.filename):\(snapshot.sealedIdentity)".utf8)
}

private func verifyDownloadSeal(_ handle: FileHandle, key: String, asset: DropCompletedDownloadAsset,
                                snapshot: DownloadFileSnapshot) throws {
  let expected = downloadSeal(key, asset, snapshot)
  var actual = Data(count: expected.count)
  let length = actual.withUnsafeMutableBytes {
    fgetxattr(handle.fileDescriptor, downloadSealAttribute, $0.baseAddress, $0.count, 0, 0)
  }
  guard snapshot.size == asset.sizeBytes, length == expected.count, actual == expected else {
    throw DropLibraryStorageError.invalidSource
  }
}

private func sealedDownloadSnapshot(_ url: URL, key: String, asset: DropCompletedDownloadAsset) throws -> DownloadFileSnapshot {
  try withDownloadFile(url) { handle, snapshot in
    try verifyDownloadSeal(handle, key: key, asset: asset, snapshot: snapshot)
    guard try completedDownloadSnapshot(url) == snapshot else {
      throw DropLibraryStorageError.invalidSource
    }
    return snapshot
  }
}

private func verifiedDownloadSnapshot(_ url: URL, key: String, asset: DropCompletedDownloadAsset) throws -> DownloadFileSnapshot {
  try withDownloadFile(url) { handle, snapshot in
    try verifyDownloadSeal(handle, key: key, asset: asset, snapshot: snapshot)
    guard try completedDownloadDigest(handle, size: asset.sizeBytes) == asset.sha256,
          try completedDownloadSnapshot(url) == snapshot else {
      throw DropLibraryStorageError.invalidSource
    }
    return snapshot
  }
}

private func completedDownloadDigest(_ handle: FileHandle, size: Int64) throws -> String {
  var hash = SHA256()
  var read: Int64 = 0
  while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
    try Task.checkCancellation()
    read += Int64(data.count)
    guard read <= size else { throw DropLibraryStorageError.invalidSource }
    hash.update(data: data)
  }
  guard read == size else { throw DropLibraryStorageError.invalidSource }
  return hash.finalize().map { String(format: "%02x", $0) }.joined()
}
