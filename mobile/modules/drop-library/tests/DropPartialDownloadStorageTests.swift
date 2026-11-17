import CryptoKit
import Darwin
import Foundation

private enum TestFailure: Error { case failed(String) }

@main
enum DropPartialDownloadStorageTests {
  static let key = "test-attempt.1"
  static let newer = "test-attempt.2"
  static let empty = digest(Data())
  static let first = Data("abc".utf8)
  static let last = Data("def".utf8)

  static func main() throws {
    try fixture("append, restore and full digest") { directory, storage in
      let a = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      try expect(a.confirmedBytes == 3 && a.prefixSha256 == digest(first), "first checkpoint")
      let reopened = DropPartialDownloadStorage(directory: directory)
      try reopened.verify(key: key, offset: 3, digest: a.prefixSha256)
      let b = try reopened.append(key: key, offset: 3, digest: a.prefixSha256, total: 6, bytes: last)
      try expect(b.confirmedBytes == 6 && b.prefixSha256 == digest(first + last), "full digest")
      #if os(iOS)
      let properties = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
      try expect(properties.isExcludedFromBackup == true, "backup exclusion")
      #endif
    }
    try fixture("uncommitted bytes, including a rollback without restart") { directory, storage in
      let a = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      _ = try storage.append(key: key, offset: 3, digest: a.prefixSha256, total: 6, bytes: last)
      let b = try storage.append(key: key, offset: 3, digest: a.prefixSha256, total: 6,
                                 bytes: Data("XYZ".utf8))
      try expect(b.prefixSha256 == digest(Data("abcXYZ".utf8)), "rollback clears in-memory hash")
      try DropPartialDownloadStorage(directory: directory).verify(key: key, offset: 3, digest: a.prefixSha256)
      let recovered = try Data(contentsOf: payload(directory))
      try expect(recovered == first, "remove only unconfirmed tail")
    }
    try fixture("multi-block incremental hash agrees with recovery") { directory, storage in
      let blocks = [Data(repeating: 0x35, count: 1_048_576),
                    Data(repeating: 0x98, count: 1_048_576), last]
      let complete = blocks.reduce(Data(), +)
      var offset: Int64 = 0
      var prefix = empty
      for block in blocks {
        let next = try storage.append(key: key, offset: offset, digest: prefix,
                                      total: Int64(complete.count), bytes: block)
        offset = next.confirmedBytes
        prefix = next.prefixSha256
      }
      try expect(offset == complete.count && prefix == digest(complete), "exact offset and digest")
      let reopened = DropPartialDownloadStorage(directory: directory)
      try reopened.verify(key: key, offset: offset, digest: prefix)
    }
    try fixture("corruption leaves file untouched") { directory, storage in
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      try writeInPlace(payload(directory), Data("xyz-tail".utf8))
      try rejects { try storage.verify(key: key, offset: 3, digest: digest(first)) }
      let data = try Data(contentsOf: payload(directory))
      try expect(data == Data("xyz-tail".utf8), "preserve damaged prefix and tail")
    }
    try fixture("short and missing checkpoint cannot be recovered") { directory, storage in
      try storage.verify(key: key, offset: 0, digest: empty)
      try rejects { try storage.verify(key: key, offset: 3, digest: digest(first)) }
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      let handle = try FileHandle(forWritingTo: payload(directory))
      try handle.truncate(atOffset: 2)
      try handle.close()
      try rejects { try storage.verify(key: key, offset: 3, digest: digest(first)) }
    }
    try fixture("same bytes in a replacement inode and symlinks are rejected") { directory, storage in
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      let original = payload(directory)
      let replacement = directory.appendingPathComponent("replacement")
      // copy also copies the ownership xattr. Its inode must invalidate that seal.
      try FileManager.default.copyItem(at: original, to: replacement)
      try FileManager.default.removeItem(at: original)
      try FileManager.default.moveItem(at: replacement, to: original)
      let inode = try identity(original)
      try rejects { try storage.verify(key: key, offset: 3, digest: digest(first)) }
      try storage.discard(key: key)
      try storage.discard(key: key)
      let saved = try preserved(directory)
      try expect(try saved.count == 1 && identity(saved[0]) == inode,
                 "one preserved replacement")
      try expect(!FileManager.default.fileExists(atPath: original.path), "clear the active name")
      let data = try Data(contentsOf: saved[0])
      try expect(data == first, "preserve replacement")
      try FileManager.default.createSymbolicLink(at: original, withDestinationURL: saved[0])
      try rejects { try storage.verify(key: key, offset: 3, digest: digest(first)) }
      try storage.discard(key: key)
      try expect(try preserved(directory).count == 2, "preserve the link out of the active name")
      try expect(FileManager.default.fileExists(atPath: saved[0].path), "preserve link target")
      _ = try storage.append(key: newer, offset: 0, digest: empty, total: 6, bytes: last)
    }
    try fixture("cut before sealing preserves the draft and allows recovery and a new attempt") { directory, _ in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let draft = preparing(directory)
      try Data().write(to: draft)
      let inode = try identity(draft)
      let reopened = DropPartialDownloadStorage(directory: directory)
      try reopened.verify(key: key, offset: 0, digest: empty)
      try expect(!FileManager.default.fileExists(atPath: draft.path), "free the preparation name")
      try expect(!FileManager.default.fileExists(atPath: payload(directory).path), "no published partial")
      let saved = try preserved(directory)
      try expect(try saved.count == 1 && identity(saved[0]) == inode, "preserve the unsealed inode")
      try reopened.discard(key: key)
      try reopened.discard(key: key)
      let next = try reopened.append(key: newer, offset: 0, digest: empty, total: 6, bytes: last)
      try expect(next.prefixSha256 == digest(last), "start another generation after the interruption")
    }
    try fixture("old unsealed canonical slot no longer blocks offset zero") { directory, _ in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try Data().write(to: payload(directory))
      let inode = try identity(payload(directory))
      let reopened = DropPartialDownloadStorage(directory: directory)
      try reopened.verify(key: key, offset: 0, digest: empty)
      let saved = try preserved(directory)
      try expect(try saved.count == 1 && identity(saved[0]) == inode, "keep the old unsealed file")
      let next = try reopened.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      try expect(next.confirmedBytes == 3, "write at offset zero")
    }
    try fixture("an unverified read-only preparation can be preserved") { directory, storage in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let draft = preparing(directory)
      try first.write(to: draft)
      try expect(chmod(draft.path, 0o400) == 0, "fixture permissions")
      let inode = try identity(draft)
      try storage.verify(key: key, offset: 0, digest: empty)
      let saved = try preserved(directory)
      try expect(try saved.count == 1 && identity(saved[0]) == inode &&
                 Data(contentsOf: saved[0]) == first, "keep the read-only object")
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: last)
    }
    for stage in ["after sealing", "before rename", "after rename"] {
      try fixture("recovery cut \(stage)") { directory, storage in
        let check = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
        try expect(check.confirmedBytes == 3, "create a real sealed inode")
        let canonical = payload(directory)
        let handle = try FileHandle(forWritingTo: canonical)
        try handle.truncate(atOffset: 0)
        if stage != "after sealing" { try handle.synchronize() }
        try handle.close()
        if stage != "after rename" {
          try FileManager.default.moveItem(at: canonical, to: preparing(directory))
        }
        let before = try identity(stage == "after rename" ? canonical : preparing(directory))
        let reopened = DropPartialDownloadStorage(directory: directory)
        try reopened.verify(key: key, offset: 0, digest: empty)
        try expect(try identity(canonical) == before, "recover the same sealed inode")
        try expect(!FileManager.default.fileExists(atPath: preparing(directory).path), "clear staging")
        let next = try reopened.append(key: key, offset: 0, digest: empty, total: 6, bytes: last)
        try expect(next.prefixSha256 == digest(last), "append after the cut")
      }
    }
    try fixture("discard handles a sealed preparation and preserves an unknown quarantine") { directory, storage in
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      let source = payload(directory)
      let handle = try FileHandle(forWritingTo: source)
      try handle.truncate(atOffset: 0)
      try handle.close()
      try FileManager.default.moveItem(at: source, to: preparing(directory))
      let quarantine = directory.appendingPathComponent(".discard")
      try Data("keep".utf8).write(to: quarantine)
      let retained = try identity(quarantine)
      let reopened = DropPartialDownloadStorage(directory: directory)
      try reopened.discard(key: key)
      try reopened.discard(key: key)
      try expect(!FileManager.default.fileExists(atPath: preparing(directory).path), "discard owned staging")
      let saved = try preserved(directory)
      try expect(try saved.count == 1 && identity(saved[0]) == retained, "keep unknown quarantine inode")
      _ = try reopened.append(key: newer, offset: 0, digest: empty, total: 6, bytes: last)
    }
    try fixture("a preparation cannot replace a canonical inode owned by a newer attempt") { directory, storage in
      _ = try storage.append(key: newer, offset: 0, digest: empty, total: 6, bytes: last)
      let canonical = payload(directory)
      let liveInode = try identity(canonical)
      let draft = preparing(directory)
      try Data().write(to: draft)
      let draftInode = try identity(draft)
      try rejects { try storage.verify(key: key, offset: 0, digest: empty) }
      try rejects { try storage.discard(key: key) }
      try expect(try identity(canonical) == liveInode && Data(contentsOf: canonical) == last,
                 "preserve the newer payload")
      try expect(try identity(draft) == draftInode, "stale action leaves the preparation alone")
    }
    try fixture("quota and space checks") { directory, storage in
      let full = DropPartialDownloadStorage(directory: directory, availableBytes: { _ in 0 })
      try rejects { _ = try full.append(key: key, offset: 0, digest: empty, total: 6, bytes: first) }
      try expect(!FileManager.default.fileExists(atPath: payload(directory).path), "space failure allocates no file")
      try rejects { _ = try storage.append(key: key, offset: 0, digest: empty, total: 101 * 1024 * 1024, bytes: first) }
      try rejects { _ = try storage.append(key: key, offset: 0, digest: empty, total: 2,
                                           bytes: first) }
      let a = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      try rejects { _ = try full.append(key: key, offset: 3, digest: a.prefixSha256, total: 6, bytes: last) }
      let data = try Data(contentsOf: payload(directory))
      try expect(data == first, "space failure preserves the checkpoint")
    }
    try fixture("obsolete owner and idempotent quarantine cleanup") { directory, storage in
      _ = try storage.append(key: key, offset: 0, digest: empty, total: 6, bytes: first)
      try rejects { _ = try storage.append(key: newer, offset: 0, digest: empty, total: 6, bytes: first) }
      try rejects { try storage.discard(key: newer) }
      try FileManager.default.moveItem(at: payload(directory), to: directory.appendingPathComponent(".discard"))
      try storage.discard(key: key)
      try storage.discard(key: key)
      _ = try storage.append(key: newer, offset: 0, digest: empty, total: 6, bytes: last)
      try rejects { try storage.discard(key: key) }
      let data = try Data(contentsOf: payload(directory))
      try expect(data == last, "preserve the new generation")
    }
  }

  static func fixture(_ name: String, _ run: (URL, DropPartialDownloadStorage) throws -> Void) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let directory = root.appendingPathComponent("DownloadPartials")
    defer { try? FileManager.default.removeItem(at: root) }
    try run(directory, DropPartialDownloadStorage(directory: directory))
    print("PASS \(name)")
  }

  static func payload(_ directory: URL) -> URL { directory.appendingPathComponent("payload.partial") }

  static func preparing(_ directory: URL) -> URL { directory.appendingPathComponent(".preparing") }

  static func preserved(_ directory: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix(".preserved-") }
  }

  static func identity(_ url: URL) throws -> UInt64 {
    var info = stat()
    guard lstat(url.path, &info) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    return info.st_ino
  }

  static func writeInPlace(_ url: URL, _ bytes: Data) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.write(contentsOf: bytes)
    try handle.synchronize()
  }

  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  static func expect(_ value: Bool, _ detail: String) throws {
    if !value { throw TestFailure.failed(detail) }
  }

  static func rejects(_ action: () throws -> Void) throws {
    do { try action() } catch { return }
    throw TestFailure.failed("Unexpected success")
  }
}
