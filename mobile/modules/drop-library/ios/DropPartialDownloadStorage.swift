import CryptoKit
import Darwin
import Foundation

struct DropPartialWriteReceipt {
  let confirmedBytes: Int64
  let prefixSha256: String
}

enum DropPartialDownloadError: Error {
  case invalidCheckpoint, invalidFile, insufficientSpace, unavailable
}

final class DropPartialDownloadStorage: @unchecked Sendable {
  private static let lock = NSLock()
  private static let payload = "payload.partial"
  private static let preparation = ".preparing"
  private static let quarantine = ".discard"
  private static let seal = "com.odincarballo.drop.partial-owner"
  private static let maximumBytes: Int64 = 100 * 1_048_576
  private static let chunkBytes = 1_048_576
  private static let reserveBytes: Int64 = 32 * 1_048_576
  private static let emptyDigest = digest(SHA256())

  static let standard: DropPartialDownloadStorage? = FileManager.default
    .urls(for: .applicationSupportDirectory, in: .userDomainMask).first.map {
      DropPartialDownloadStorage(directory: $0.appendingPathComponent("Drop", isDirectory: true)
        .appendingPathComponent("DownloadPartials", isDirectory: true))
    }

  private let directory: URL
  private let availableBytes: @Sendable (Int32) throws -> Int64
  // Protected by the same lock as the file. A rolled-back checkpoint never
  // matches the size and digest used to cache the newer hash state.
  private var cached: (key: String, stamp: FileStamp, digest: String, hash: SHA256)?

  init(
    directory: URL,
    availableBytes: @escaping @Sendable (Int32) throws -> Int64 = { try DropPartialDownloadStorage.freeBytes($0) }
  ) {
    self.directory = directory
    self.availableBytes = availableBytes
  }

  func append(key: String, offset: Int64, digest: String, total: Int64, bytes: Data) throws -> DropPartialWriteReceipt {
    try Self.validate(key: key, offset: offset, digest: digest)
    guard total > 0, total <= Self.maximumBytes, offset <= total,
          (1...Self.chunkBytes).contains(bytes.count), Int64(bytes.count) <= total - offset else {
      throw DropPartialDownloadError.invalidCheckpoint
    }

    return try Self.lock.withLock {
      let receipt = try withDirectory(create: offset == 0) { dir in
        try Self.requireNoDiscard(dir, key: key, reconcile: offset == 0)
        guard try availableBytes(dir) >= Self.reserveBytes + Int64(bytes.count) else {
          throw DropPartialDownloadError.insufficientSpace
        }
        guard let fd = try (offset == 0
          ? Self.reconcilePreparation(dir, key: key, create: true)
          : Self.openExisting(dir, Self.payload, key: key)) else {
          throw DropPartialDownloadError.invalidFile
        }
        defer { _ = close(fd) }

        var hash = try verifiedPrefix(fd, dir, key: key, offset: offset, digest: digest, forceRead: false)
        try Self.write(bytes, into: fd, at: offset)
        let end = offset + Int64(bytes.count)
        let after = try Self.attest(fd, dir, name: Self.payload, key: key)
        guard after.size == end else { throw DropPartialDownloadError.invalidFile }
        try Self.sync(fd)
        try Self.sync(dir)
        guard try Self.attest(fd, dir, name: Self.payload, key: key) == after else {
          throw DropPartialDownloadError.invalidFile
        }
        hash.update(data: bytes)
        let prefix = Self.digest(hash)
        cached = (key, after, prefix, hash)
        return DropPartialWriteReceipt(confirmedBytes: end, prefixSha256: prefix)
      }
      guard let receipt else { throw DropPartialDownloadError.invalidFile }
      return receipt
    }
  }

  func verify(key: String, offset: Int64, digest: String) throws {
    try Self.validate(key: key, offset: offset, digest: digest)
    try Self.lock.withLock {
      let found = try withDirectory(create: false) { dir in
        try Self.requireNoDiscard(dir, key: key, reconcile: offset == 0)
        guard let fd = try (offset == 0
          ? Self.reconcilePreparation(dir, key: key, create: false)
          : Self.openExisting(dir, Self.payload, key: key)) else {
          return false
        }
        defer { _ = close(fd) }
        _ = try verifiedPrefix(fd, dir, key: key, offset: offset, digest: digest, forceRead: true)
        return true
      }
      if found != true && offset > 0 { throw DropPartialDownloadError.invalidFile }
    }
  }

  func discard(key: String) throws {
    try Self.validate(key: key, offset: 0, digest: Self.emptyDigest)
    try Self.lock.withLock {
      _ = try withDirectory(create: false) { dir in
        let names: [(String, ExistingPolicy)] = [
          (Self.quarantine, .preserveUnknown), (Self.payload, .preserveUnknown),
          (Self.preparation, .preparation),
        ]
        // Inspect all active names before deleting anything. A stale discard
        // must not consume an object sealed for another attempt.
        var owned: [(String, Int32)] = []
        defer { for (_, fd) in owned { _ = close(fd) } }
        for (name, policy) in names {
          if let fd = try Self.openExisting(dir, name, key: key, policy: policy, writable: false) {
            owned.append((name, fd))
          }
        }
        for (name, fd) in owned {
          try Self.removeOwned(fd, dir, name: name, key: key)
        }
        // Also persist a previous unlink that succeeded before a failed sync.
        try Self.sync(dir)
      }
      if cached?.key == key { cached = nil }
    }
  }

  private func verifiedPrefix(
    _ fd: Int32, _ dir: Int32, key: String, offset: Int64, digest: String, forceRead: Bool
  ) throws -> SHA256 {
    let before = try Self.attest(fd, dir, name: Self.payload, key: key)
    guard before.size >= offset else { throw DropPartialDownloadError.invalidFile }
    if !forceRead, let cached, cached.key == key, cached.stamp == before,
       before.size == offset, cached.digest == digest {
      return cached.hash
    }

    let hash = try Self.hashPrefix(fd, bytes: offset)
    guard Self.digest(hash) == digest,
          try Self.attest(fd, dir, name: Self.payload, key: key) == before else {
      throw DropPartialDownloadError.invalidFile
    }
    if before.size > offset {
      guard ftruncate(fd, offset) == 0 else { throw Self.posixError() }
      try Self.sync(fd)
    }
    let after = try Self.attest(fd, dir, name: Self.payload, key: key)
    guard after.size == offset else { throw DropPartialDownloadError.invalidFile }
    cached = (key, after, digest, hash)
    return hash
  }

  private func withDirectory<T>(create: Bool, _ body: (Int32) throws -> T) throws -> T? {
    guard DropLibraryPaths.isUnredirected(directory) else { throw DropPartialDownloadError.invalidFile }
    if create {
      let manager = FileManager.default
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      guard DropLibraryPaths.isUnredirected(directory) else { throw DropPartialDownloadError.invalidFile }
      var folder = directory
      if try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup != true {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
      }
      // On a first write or retry, persist both directory links before any bytes.
      let parent = directory.deletingLastPathComponent()
      try Self.syncDirectory(parent)
      try Self.syncDirectory(parent.deletingLastPathComponent())
    }
    let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    if fd < 0 {
      if !create && errno == ENOENT { return nil }
      throw Self.posixError()
    }
    defer { _ = close(fd) }
    return try body(fd)
  }

  private static func validate(key: String, offset: Int64, digest: String) throws {
    let parts = key.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 2, (1...64).contains(parts[0].utf8.count),
          parts[0].utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) || $0 == 45 }),
          let generation = Int64(parts[1]), generation > 0, generation <= 9_007_199_254_740_991,
          String(generation) == parts[1], (0...maximumBytes).contains(offset),
          digest.utf8.count == 64,
          digest.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
          offset != 0 || digest == emptyDigest else {
      throw DropPartialDownloadError.invalidCheckpoint
    }
  }

  private struct FileStamp: Equatable {
    let identity: String
    let size: Int64
    let modification: [Int]
    let change: [Int]

    init(_ info: stat) throws {
      guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_size >= 0 else {
        throw DropPartialDownloadError.invalidFile
      }
      identity = "\(info.st_dev):\(info.st_ino):\(info.st_birthtimespec.tv_sec):\(info.st_birthtimespec.tv_nsec)"
      size = info.st_size
      modification = [info.st_mtimespec.tv_sec, info.st_mtimespec.tv_nsec]
      change = [info.st_ctimespec.tv_sec, info.st_ctimespec.tv_nsec]
    }
  }

  private static func descriptorStamp(_ fd: Int32) throws -> FileStamp {
    var info = stat()
    guard fstat(fd, &info) == 0 else { throw posixError() }
    return try FileStamp(info)
  }

  private static func exists(_ dir: Int32, _ name: String) throws -> Bool {
    var info = stat()
    if fstatat(dir, name, &info, AT_SYMLINK_NOFOLLOW) == 0 { return true }
    if errno == ENOENT { return false }
    throw posixError()
  }

  private static func attest(_ fd: Int32, _ dir: Int32, name: String, key: String) throws -> FileStamp {
    let stamp = try descriptorStamp(fd)
    let expected = Data("\(key):\(stamp.identity)".utf8)
    var value = Data(count: expected.count)
    let count = value.withUnsafeMutableBytes {
      fgetxattr(fd, seal, $0.baseAddress, $0.count, 0, 0)
    }
    var named = stat()
    guard count == expected.count, value == expected,
          fstatat(dir, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
          try FileStamp(named) == stamp else { throw DropPartialDownloadError.invalidFile }
    return stamp
  }

  private enum ExistingPolicy { case exact, preserveUnknown, preparation }

  private static func openExisting(
    _ dir: Int32, _ name: String, key: String, policy: ExistingPolicy = .exact, writable: Bool = true
  ) throws -> Int32? {
    var named = stat()
    if fstatat(dir, name, &named, AT_SYMLINK_NOFOLLOW) != 0 {
      if errno == ENOENT { return nil }
      throw posixError()
    }
    guard let stamp = try? FileStamp(named) else {
      guard policy != .exact else { throw DropPartialDownloadError.invalidFile }
      try preserve(dir, name)
      return nil
    }
    let flags = O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
    var fd = openat(dir, name, flags | (writable ? O_RDWR : O_RDONLY))
    var writeError: POSIXError?
    if fd < 0, writable, policy != .exact, errno == EACCES || errno == EPERM {
      // A foreign object may be readable without being writable. Inspect its
      // seal before deciding whether its name can be moved aside.
      writeError = posixError()
      fd = openat(dir, name, flags | O_RDONLY)
    }
    guard fd >= 0 else { throw posixError() }
    var keepOpen = false
    defer { if !keepOpen { _ = close(fd) } }
    if policy == .exact {
      guard try attest(fd, dir, name: name, key: key) == stamp else {
        throw DropPartialDownloadError.invalidFile
      }
    } else {
      let owner = try recognizedOwner(fd, stamp: stamp)
      guard try descriptorStamp(fd) == stamp else { throw DropPartialDownloadError.invalidFile }
      if owner != key || (policy == .preparation && stamp.size != 0) {
        guard owner == nil || policy == .preparation else {
          throw DropPartialDownloadError.invalidFile
        }
        try preserve(dir, name)
        return nil
      }
      _ = try attest(fd, dir, name: name, key: key)
    }
    if let writeError { throw writeError }
    keepOpen = true
    return fd
  }

  private static func recognizedOwner(_ fd: Int32, stamp: FileStamp) throws -> String? {
    var value = Data(count: 256)
    let count = value.withUnsafeMutableBytes {
      fgetxattr(fd, seal, $0.baseAddress, $0.count, 0, 0)
    }
    if count < 0 {
      if errno == ENOATTR || errno == ERANGE { return nil }
      throw posixError()
    }
    let suffix = ":\(stamp.identity)"
    guard let text = String(data: value.prefix(count), encoding: .utf8),
          text.hasSuffix(suffix) else { return nil }
    let key = String(text.dropLast(suffix.count))
    guard (try? validate(key: key, offset: 0, digest: emptyDigest)) != nil else { return nil }
    return key
  }

  private static func preserve(_ dir: Int32, _ name: String) throws {
    let retained = ".preserved-\(UUID().uuidString.lowercased())"
    try renameExclusive(dir, from: name, to: retained)
    try sync(dir)
  }

  private static func requireNoDiscard(_ dir: Int32, key: String, reconcile: Bool) throws {
    if reconcile {
      if let fd = try openExisting(dir, quarantine, key: key, policy: .preserveUnknown, writable: false) {
        _ = close(fd)
        throw DropPartialDownloadError.invalidFile
      }
    } else if try exists(dir, quarantine) {
      throw DropPartialDownloadError.invalidFile
    }
  }

  private static func reconcilePreparation(_ dir: Int32, key: String, create: Bool) throws -> Int32? {
    if let current = try openExisting(dir, payload, key: key, policy: .preserveUnknown) {
      do {
        if try exists(dir, preparation) { try preserve(dir, preparation) }
        return current
      } catch {
        _ = close(current)
        throw error
      }
    }
    let staged = try openExisting(dir, preparation, key: key, policy: .preparation)
    guard let fd = try staged ?? (create ? createPreparation(dir, key: key) : nil) else {
      return nil
    }
    do {
      let before = try attest(fd, dir, name: preparation, key: key)
      guard before.size == 0 else { throw DropPartialDownloadError.invalidFile }
      try sync(fd)
      try sync(dir)
      try renameExclusive(dir, from: preparation, to: payload)
      let published = try attest(fd, dir, name: payload, key: key)
      guard published.identity == before.identity, published.size == 0 else {
        throw DropPartialDownloadError.invalidFile
      }
      try sync(dir)
      return fd
    } catch {
      _ = close(fd)
      throw error
    }
  }

  private static func createPreparation(_ dir: Int32, key: String) throws -> Int32 {
    let flags = O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_CREAT | O_EXCL
    let fd = openat(dir, preparation, flags, mode_t(0o600))
    guard fd >= 0 else { throw posixError() }
    do {
      let stamp = try descriptorStamp(fd)
      let value = Data("\(key):\(stamp.identity)".utf8)
      let result = value.withUnsafeBytes { fsetxattr(fd, seal, $0.baseAddress, $0.count, 0, XATTR_CREATE) }
      guard result == 0 else { throw posixError() }
      _ = try attest(fd, dir, name: preparation, key: key)
      return fd
    } catch {
      _ = close(fd)
      throw error
    }
  }

  private static func renameExclusive(_ dir: Int32, from: String, to: String) throws {
    guard renameatx_np(dir, from, dir, to, UInt32(RENAME_EXCL)) == 0 else { throw posixError() }
  }

  private static func removeOwned(_ fd: Int32, _ dir: Int32, name: String, key: String) throws {
    _ = try attest(fd, dir, name: name, key: key)
    if name != quarantine { try renameExclusive(dir, from: name, to: quarantine) }
    do {
      _ = try attest(fd, dir, name: quarantine, key: key)
    } catch {
      if name != quarantine { try? renameExclusive(dir, from: quarantine, to: name) }
      throw error
    }
    guard unlinkat(dir, quarantine, 0) == 0 else { throw posixError() }
  }

  private static func hashPrefix(_ fd: Int32, bytes: Int64) throws -> SHA256 {
    var hash = SHA256()
    var offset: Int64 = 0
    var buffer = Data(count: Int(min(bytes, Int64(chunkBytes))))
    while offset < bytes {
      let length = Int(min(bytes - offset, Int64(buffer.count)))
      var count: Int
      repeat {
        count = buffer.withUnsafeMutableBytes { pread(fd, $0.baseAddress, length, offset) }
      } while count < 0 && errno == EINTR
      if count < 0 { throw posixError() }
      guard count > 0 else { throw DropPartialDownloadError.invalidFile }
      hash.update(data: buffer.prefix(count))
      offset += Int64(count)
    }
    return hash
  }

  private static func write(_ bytes: Data, into fd: Int32, at offset: Int64) throws {
    try bytes.withUnsafeBytes { buffer in
      var written = 0
      while written < buffer.count {
        let result = pwrite(fd, buffer.baseAddress?.advanced(by: written), buffer.count - written,
                            offset + Int64(written))
        if result < 0 && errno == EINTR { continue }
        if result < 0 { throw posixError() }
        guard result > 0 else { throw POSIXError(.EIO) }
        written += result
      }
    }
  }

  private static func digest(_ hash: SHA256) -> String {
    hash.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func sync(_ fd: Int32) throws {
    while fsync(fd) != 0 {
      if errno != EINTR { throw posixError() }
    }
  }

  private static func syncDirectory(_ url: URL) throws {
    let fd = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw posixError() }
    defer { _ = close(fd) }
    try sync(fd)
  }

  private static func freeBytes(_ fd: Int32) throws -> Int64 {
    var info = statfs()
    guard fstatfs(fd, &info) == 0 else { throw posixError() }
    let (bytes, overflow) = info.f_bavail.multipliedReportingOverflow(by: UInt64(info.f_bsize))
    return overflow ? Int64.max : Int64(clamping: bytes)
  }

  private static func posixError() -> POSIXError {
    POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
