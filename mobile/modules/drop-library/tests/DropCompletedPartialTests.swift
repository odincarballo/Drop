import CryptoKit
import Darwin
import Foundation

enum HandoffFailure: Error { case expectedOwnedInode, badFixture, unexpectedSuccess }

@main
enum DropCompletedPartialTests {
  static func main() async throws {
    let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    for presealed in [false, true] {
      try await verify(fixture, presealed: presealed)
    }
    try await discardDamagedStage(fixture, truncate: false)
    try await discardDamagedStage(fixture, truncate: true)
    try await discardDamagedStage(fixture, truncate: false, quarantined: true)
    try await rejectsForeignStage(fixture)
    try await rejectsForeignRetention(fixture)
  }

  static func verify(_ fixture: Data, presealed: Bool) async throws {
    let manager = FileManager.default
    let temporary = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? manager.removeItem(at: temporary) }
    let support = temporary.appendingPathComponent("Support")
    let cache = temporary.appendingPathComponent("Cache")
    try manager.createDirectory(at: cache, withIntermediateDirectories: true)
    let library = try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
    let directory = library.root.appendingPathComponent("DownloadPartials")
    let partials = DropPartialDownloadStorage(directory: directory)
    let key = "swift-handoff.1"
    let empty = sha(Data())
    let sum = sha(fixture)
    let asset = DropCompletedDownloadAsset(id: UUID().uuidString.lowercased(), ext: "m4a",
      sizeBytes: Int64(fixture.count), sha256: sum)
    let source = directory.appendingPathComponent("payload.partial")
    _ = try partials.append(key: key, offset: 0, digest: empty, total: asset.sizeBytes, bytes: fixture)
    var info = stat()
    guard lstat(source.path, &info) == 0 else { throw HandoffFailure.badFixture }
    if presealed {
      let identity = "\(info.st_dev):\(info.st_ino):\(info.st_birthtimespec.tv_sec):\(info.st_birthtimespec.tv_nsec):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec)"
      let stamp = Data("\(key):\(asset.filename):\(identity)".utf8)
      let fd = open(source.path, O_RDWR | O_NOFOLLOW)
      guard fd >= 0 else { throw HandoffFailure.badFixture }
      let result = stamp.withUnsafeBytes {
        fsetxattr(fd, "com.odincarballo.drop.download-seal", $0.baseAddress, $0.count, 0, XATTR_CREATE)
      }
      _ = close(fd)
      guard result == 0 else { throw HandoffFailure.badFixture }
    }
    try await library.stageCompletedPartial(key: key, asset: asset, mediaType: "audio", partials: partials)
    let staging = library.root.appendingPathComponent("DownloadStaging/\(key)/\(asset.filename)")
    try await library.stageCompletedPartial(key: key, asset: asset, mediaType: "audio", partials: partials)
    guard !manager.fileExists(atPath: source.path), try library.findCompletedDownload(key: key, size: asset.sizeBytes) == asset
    else { throw HandoffFailure.expectedOwnedInode }
    var staged = stat()
    guard lstat(staging.path, &staged) == 0, staged.st_ino == info.st_ino else {
      throw HandoffFailure.expectedOwnedInode
    }
    let token = try library.placeCompletedDownload(key: key, asset: asset, move: true)
    try DropLibraryStorage.verifyCompletedDownload(token: token)
    DropLibraryStorage.releaseCompletedDownload(token: token)
    try await library.stageCompletedPartial(key: key, asset: asset, mediaType: "audio", partials: partials)
    let placed = library.root.appendingPathComponent(asset.relativeMediaPath)
    var final = stat()
    guard lstat(placed.path, &final) == 0, final.st_ino == info.st_ino,
          try sha(Data(contentsOf: placed)) == sum else { throw HandoffFailure.expectedOwnedInode }
    print("PASS \(presealed ? "reopen after B seal" : "complete C checkpoint"), stage, reopen and publish same inode")
  }

  static func sha(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  static func withStagedPartial(
    _ fixture: Data, _ test: (DropLibraryStorage, String, DropCompletedDownloadAsset, URL) async throws -> Void
  ) async throws {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let cache = temporary.appendingPathComponent("Cache")
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    let library = try DropLibraryStorage(supportDirectory: temporary.appendingPathComponent("Support"), cacheDirectory: cache)
    let partials = DropPartialDownloadStorage(directory: library.root.appendingPathComponent("DownloadPartials"))
    let key = "discard-partial.1"
    let asset = DropCompletedDownloadAsset(id: UUID().uuidString.lowercased(), ext: "m4a",
      sizeBytes: Int64(fixture.count), sha256: sha(fixture))
    _ = try partials.append(key: key, offset: 0, digest: sha(Data()), total: asset.sizeBytes, bytes: fixture)
    try await library.stageCompletedPartial(key: key, asset: asset, mediaType: "audio", partials: partials)
    let staged = library.root.appendingPathComponent("DownloadStaging/\(key)/\(asset.filename)")
    try await test(library, key, asset, staged)
  }

  static func discardDamagedStage(_ fixture: Data, truncate: Bool, quarantined: Bool = false) async throws {
    try await withStagedPartial(fixture) { library, key, asset, staged in
      let manager = FileManager.default
      let quarantine = staged.deletingLastPathComponent().appendingPathComponent(".discard")
      if quarantined {
        try manager.moveItem(at: staged, to: quarantine)
      }
      let handle = try FileHandle(forUpdating: quarantined ? quarantine : staged)
      var damage = fixture
      if truncate {
        try handle.truncate(atOffset: 0)
        damage = Data()
      } else {
        damage[fixture.count / 2] ^= 0xff
        try handle.seek(toOffset: UInt64(fixture.count / 2))
        try handle.write(contentsOf: damage.subdata(in: (fixture.count / 2)..<(fixture.count / 2 + 1)))
      }
      try handle.close()
      let retained = library.root.appendingPathComponent("DownloadStaging/.preserved/\(key)/\(asset.filename)")
      try library.discardCompletedDownload(key: key, asset: asset)
      let support = library.root.deletingLastPathComponent()
      let cache = support.deletingLastPathComponent().appendingPathComponent("Cache")
      let reopened = try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
      try reopened.discardCompletedDownload(key: key, asset: asset)
      guard !manager.fileExists(atPath: staged.path), !manager.fileExists(atPath: quarantine.path),
            try Data(contentsOf: retained) == damage else { throw HandoffFailure.badFixture }
      let scenario = quarantined ? "previously quarantined" : (truncate ? "truncated" : "corrupt")
      print("PASS retained \(scenario) file after reopening and repeating discard")
    }
  }

  static func rejectsForeignStage(_ fixture: Data) async throws {
    try await withStagedPartial(fixture) { library, key, asset, staged in
      // Replace the inode while retaining the filename and the original bytes.
      try fixture.write(to: staged, options: .atomic)
      do {
        try library.discardCompletedDownload(key: key, asset: asset)
        throw HandoffFailure.unexpectedSuccess
      } catch DropLibraryStorageError.invalidSource {}
      guard try Data(contentsOf: staged) == fixture else { throw HandoffFailure.badFixture }
      print("PASS discard preserves foreign replacement")
    }
  }

  static func rejectsForeignRetention(_ fixture: Data) async throws {
    try await withStagedPartial(fixture) { library, key, asset, staged in
      let retained = library.root.appendingPathComponent("DownloadStaging/.preserved/\(key)/\(asset.filename)")
      try FileManager.default.createDirectory(at: retained.deletingLastPathComponent(), withIntermediateDirectories: true)
      let foreign = Data("foreign".utf8)
      try foreign.write(to: retained)
      do {
        try library.discardCompletedDownload(key: key, asset: asset)
        throw HandoffFailure.unexpectedSuccess
      } catch DropLibraryStorageError.invalidSource {}
      guard try Data(contentsOf: retained) == foreign,
            try Data(contentsOf: staged) == fixture else { throw HandoffFailure.badFixture }
      print("PASS discard does not overwrite a foreign preservation target")
    }
  }
}
