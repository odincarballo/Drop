import Foundation

actor ImportGate {
  private var continuation: CheckedContinuation<Void, Never>?
  private(set) var started = false
  func wait() async {
    started = true
    await withCheckedContinuation { continuation = $0 }
  }
  func release() { continuation?.resume(); continuation = nil }
}

final class ScopeSpy: @unchecked Sendable {
  private let lock = NSLock()
  private var opened = 0
  private var closed = 0
  private var copied: [(Int64, Int64)] = []
  func report(_ bytes: Int64, _ total: Int64) { lock.lock(); defer { lock.unlock() }; copied.append((bytes, total)) }
  func reports() -> [(Int64, Int64)] { lock.lock(); defer { lock.unlock() }; return copied }
  func start(_ url: URL) -> Bool { lock.lock(); defer { lock.unlock() }; opened += 1; return true }
  func stop(_ url: URL) { lock.lock(); defer { lock.unlock() }; closed += 1 }
  func counts() -> (Int, Int) { lock.lock(); defer { lock.unlock() }; return (opened, closed) }
}

@main
@MainActor
struct DropLocalImportOperationTests {
  static func main() async throws {
    let selection = URL(fileURLWithPath: "/private/tmp/synthetic-selection.mp3")
    let prepared = DropPreparedLocalFile(uri: "file:///private/tmp/Caches/DropImport/uuid/payload.mp3",
      title: "Audio", mediaType: "audio", durationSeconds: 3)
    var results: [DropLocalImportOutcome] = []
    var updates: [DropLocalImportUpdate] = []
    let gate = ImportGate()
    let operation = DropLocalImportOperation(prepare: { _, progress in
      await gate.wait()
      progress(40, 100)
      progress(10, 100)
      return prepared
    }, discard: { _ in }, onUpdate: { updates.append($0) }, completion: { results.append($0) })
    operation.selected([selection])
    operation.selected([selection])
    await wait { await gate.started }
    await gate.release()
    await wait { !results.isEmpty }
    try check(results == [.prepared(prepared)], "single callback and result")
    try check(updates.first?.phase == .preparing, "preparing event")
    operation.selected([selection])
    try check(results.count == 1 && !operation.cancel(), "completed operation immutable")

    results = []
    let cancelled = DropLocalImportOperation(prepare: { _, _ in fatalError("cancel opened source") },
      discard: { _ in }, onUpdate: { _ in }, completion: { results.append($0) })
    try check(cancelled.cancel(), "picker cancellation")
    cancelled.selected([selection])
    try check(results == [.cancelled], "selection cancellation is harmless")

    results = []
    var discarded: [DropPreparedLocalFile] = []
    let blockedProvider = ImportGate()
    let cancelling = DropLocalImportOperation(prepare: { _, _ in
      await blockedProvider.wait()
      return prepared
    }, discard: { discarded.append($0) }, onUpdate: { updates.append($0) }, completion: { results.append($0) })
    cancelling.selected([selection])
    await wait { await blockedProvider.started }
    try check(cancelling.cancel(), "copy cancellation accepted")
    try check(results.isEmpty && discarded.isEmpty, "reader still owns its file")
    await blockedProvider.release()
    await wait { !results.isEmpty }
    try check(results == [.cancelled] && discarded == [prepared], "late copy discarded after reader exits")

    for failure in [DropLocalImportFailure.scopeDenied, .readFailed, .invalidFile, .insufficientSpace] {
      results = []
      let failed = DropLocalImportOperation(prepare: { _, _ in throw failure },
        discard: { _ in }, onUpdate: { _ in }, completion: { results.append($0) })
      failed.selected([selection])
      await wait { !results.isEmpty }
      try check(results == [.failed(failure)], "sanitized preparation failure")
    }

    let scope = ScopeSpy()
    do {
      _ = try await DropLocalImportOperation.prepareAuthorized(from: selection,
        startAccess: { _ in false }, stopAccess: { _ in fatalError("unopened scope closed") },
        stage: { _, _ in fatalError("denied URL read") })
      fatalError("scope denial accepted")
    } catch DropLocalImportFailure.scopeDenied {}
    for fail in [false, true] {
      do {
        let result = try await DropLocalImportOperation.prepareAuthorized(from: selection,
          startAccess: { scope.start($0) }, stopAccess: { scope.stop($0) },
          stage: { _, _ in
            if fail { throw DropLocalImportFailure.readFailed }
            return prepared
          })
        try check(result == prepared && !fail, "prepared result")
      } catch DropLocalImportFailure.readFailed { try check(fail, "expected read failure") }
    }
    try check(scope.counts() == (2, 2), "balanced scope on success and failure")

    // Use the real coordinated copier with synthetic media and injected access.
    let manager = FileManager.default
    let sandbox = manager.temporaryDirectory.resolvingSymlinksInPath()
      .appendingPathComponent("drop-picker-operation-\(UUID().uuidString)")
    try manager.createDirectory(at: sandbox, withIntermediateDirectories: false)
    defer { try? manager.removeItem(at: sandbox) }
    let original = sandbox.appendingPathComponent("Original.mp3")
    let frame = Data([0xff, 0xfb, 0x90, 0xc4]) + Data(count: 413)
    let bytes = (0..<32).reduce(into: Data()) { buffer, _ in buffer.append(frame) }
    try bytes.write(to: original)
    let support = sandbox.appendingPathComponent("Application Support")
    let cache = sandbox.appendingPathComponent("Caches")
    let copied = try await DropLocalImportOperation.prepareAuthorized(from: original,
      progress: { scope.report($0, $1) }, startAccess: { scope.start($0) }, stopAccess: { scope.stop($0) },
      stage: { url, progress in
        let value = try await DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
          .stageLocalFile(from: url, capacity: { _ in 4_000_000_000 }, progress: progress)
        return DropPreparedLocalFile(uri: value.uri, title: value.title,
          mediaType: value.mediaType, durationSeconds: value.durationSeconds)
      })
    try check(copied.mediaType == "audio" && copied.title == "Original", "real preparation metadata")
    try check(try Data(contentsOf: original) == bytes, "original intact")
    try check(scope.counts() == (3, 3), "real copy releases scope")
    try check(scope.reports().first?.0 == 0 && scope.reports().last?.0 == Int64(bytes.count), "measured copy progress")
    try check(scope.reports().allSatisfy { $0.1 == Int64(bytes.count) }, "measured total")
    try check(DropLocalImportFailure.classified(NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)) == .readFailed,
              "provider errors expose no paths")
    try check(DropLocalImportFailure.classified(POSIXError(.ENOSPC)) == .insufficientSpace, "disk error classification")
    try check(DropLocalImportFailure.classified(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)) == .insufficientSpace,
              "coordinated file write has insufficient space")
    print("DropLocalImportOperationTests: passed (single selection, cancellation, late callbacks, scope, failures and original)")
  }

  static func wait(_ condition: () async -> Bool) async {
    for _ in 0..<100 {
      if await condition() { return }
      try? await Task.sleep(nanoseconds: 10_000_000)
    }
    fatalError("import operation did not settle")
  }

  static func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
    if try !condition() { throw NSError(domain: label, code: 1) }
  }
}
