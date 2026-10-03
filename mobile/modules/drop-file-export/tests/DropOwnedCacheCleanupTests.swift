import Foundation

private enum TestFailure: Error { case failed(String) }

private final class FailingRemovalFileManager: FileManager {
  override func removeItem(at url: URL) throws {
    throw TestFailure.failed("simulated storage error")
  }
}

@main
enum DropOwnedCacheCleanupTests {
  static func main() throws {
    let fileManager = FileManager.default
    let cache = fileManager.temporaryDirectory.appendingPathComponent(
      "DropOwnedCacheCleanupTests-\(UUID().uuidString)", isDirectory: true
    )
    try fileManager.createDirectory(at: cache, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: cache) }

    let root = cache.appendingPathComponent("MediaDrop", isDirectory: true)
    let job = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let unrelated = root.appendingPathComponent("unrelated", isDirectory: true)
    try fileManager.createDirectory(at: job, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: unrelated, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: job.appendingPathComponent("video.part"))
    let exportRoot = cache.appendingPathComponent("DropExport", isDirectory: true)
    let abandonedExport = exportRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let unrelatedExport = exportRoot.appendingPathComponent("unrelated", isDirectory: true)
    try fileManager.createDirectory(at: abandonedExport, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: unrelatedExport, withIntermediateDirectories: true)
    try Data("alias".utf8).write(to: abandonedExport.appendingPathComponent("Friendly.mp4"))
    let direct = cache.appendingPathComponent(
      "mediadrop-0123456789abcdef0123456789abcdef-example.mp4"
    )
    try Data("partial".utf8).write(to: direct)
    let foreign = cache.appendingPathComponent("other-file.mp4")
    try Data("keep".utf8).write(to: foreign)
    let library = cache.deletingLastPathComponent().appendingPathComponent(
      "DropLibraryCleanupTests-\(UUID().uuidString)", isDirectory: true
    )
    try fileManager.createDirectory(at: library, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: library) }
    let persistent = library.appendingPathComponent("saved.mp4")
    try Data("persistent".utf8).write(to: persistent)

    let result = DropOwnedCacheCleanup.run(cacheDirectory: cache, fileManager: fileManager)
    guard result.removed == 3, result.failures == 0,
          !fileManager.fileExists(atPath: job.path),
          !fileManager.fileExists(atPath: abandonedExport.path),
          !fileManager.fileExists(atPath: direct.path),
          fileManager.fileExists(atPath: unrelated.path),
          fileManager.fileExists(atPath: unrelatedExport.path),
          fileManager.fileExists(atPath: foreign.path),
          fileManager.fileExists(atPath: persistent.path) else {
      throw TestFailure.failed("Only owned abandoned files may be removed")
    }
    let again = DropOwnedCacheCleanup.run(cacheDirectory: cache, fileManager: fileManager)
    guard again.removed == 0, again.failures == 0 else {
      throw TestFailure.failed("A retry must be harmless")
    }
    for name in [
      "mediadrop-not-a-job-video.mp4",
      "mediadrop-0123456789abcdef0123456789abcdeg-video.mp4",
      "other-0123456789abcdef0123456789abcdef-video.mp4",
    ] {
      guard !DropOwnedCacheCleanup.isOwnedDirectFile(name) else {
        throw TestFailure.failed("Unexpected ownership: \(name)")
      }
    }
    let oneShotCache = cache.appendingPathComponent("one-shot", isDirectory: true)
    try fileManager.createDirectory(at: oneShotCache, withIntermediateDirectories: true)
    let firstOwned = oneShotCache.appendingPathComponent(
      "mediadrop-0123456789abcdef0123456789abcdef-first.mp4"
    )
    let laterOwned = oneShotCache.appendingPathComponent(
      "mediadrop-0123456789abcdef0123456789abcdef-later.mp4"
    )
    try Data("partial".utf8).write(to: firstOwned)
    let firstStartup = DropOwnedCacheCleanup.runOnceAtStartup(
      cacheDirectory: oneShotCache, fileManager: fileManager
    )
    try Data("active".utf8).write(to: laterOwned)
    let secondStartup = DropOwnedCacheCleanup.runOnceAtStartup(
      cacheDirectory: oneShotCache, fileManager: fileManager
    )
    guard firstStartup.removed == 1, !fileManager.fileExists(atPath: firstOwned.path),
          secondStartup.removed == 0, fileManager.fileExists(atPath: laterOwned.path) else {
      throw TestFailure.failed("Startup cleanup must run only once per native process")
    }
    let failedCleanup = DropOwnedCacheCleanup.run(
      cacheDirectory: oneShotCache, fileManager: FailingRemovalFileManager()
    )
    guard failedCleanup.failures == 1, fileManager.fileExists(atPath: laterOwned.path) else {
      throw TestFailure.failed("Storage errors must retain the file for a future retry")
    }
    let recovered = DropOwnedCacheCleanup.run(
      cacheDirectory: oneShotCache, fileManager: fileManager
    )
    guard recovered.removed == 1, !fileManager.fileExists(atPath: laterOwned.path) else {
      throw TestFailure.failed("A later startup must be able to retry cleanup")
    }
    print("DropOwnedCacheCleanupTests: passed")
  }
}
