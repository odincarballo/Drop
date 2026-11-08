import Foundation

private final class Clock: @unchecked Sendable {
  private let lock = NSLock()
  private var action: (@Sendable () -> Void)?
  private var delay = 0.0
  func schedule(_ seconds: Double, _ callback: @escaping @Sendable () -> Void)
    -> @Sendable () -> Void
  {
    lock.lock()
    delay = seconds
    action = callback
    lock.unlock()
    return {}
  }
  func fire() {
    lock.lock()
    let callback = action
    lock.unlock()
    callback?()
  }
  var seconds: Double {
    lock.lock()
    defer { lock.unlock() }
    return delay
  }
}
private final class Probe: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [Result<DropLocalMetadata, Error>] = []
  func receive(_ value: Result<DropLocalMetadata, Error>) {
    lock.lock()
    values.append(value)
    lock.unlock()
  }
  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return values.count
  }
  var title: String? {
    lock.lock()
    defer { lock.unlock() }
    return try? values.first?.get().title
  }
  var cancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return values.contains {
      if case .failure(is CancellationError) = $0 { return true }
      return false
    }
  }
}
private actor Work {
  private var continuation: CheckedContinuation<DropLocalMetadata, Error>?
  private var waiting: CheckedContinuation<Void, Never>?
  private var started = false
  func run() async throws -> DropLocalMetadata {
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      started = true
      waiting?.resume()
      waiting = nil
    }
  }
  func waitStarted() async { if !started { await withCheckedContinuation { waiting = $0 } } }
  func reply(_ value: DropLocalMetadata) {
    continuation?.resume(returning: value)
    continuation = nil
  }
}
@main
struct DropLocalImportEnrichmentTests {
  static func main() async throws {
    var failures = 0
    func check(_ ok: Bool, _ label: String) {
      print("\(ok ? "PASS" : "FAIL") \(label)")
      fflush(stdout)
      if !ok { failures += 1 }
    }
    let coordinator = DropLocalImportEnrichment()
    let clock = Clock()
    let work = Work()
    let probe = Probe()
    let request = DropEnrichmentRequest()
    request.observe { probe.receive($0) }
    let task = coordinator.begin(
      request, work: { try await work.run() }, schedule: { clock.schedule($0, $1) })
    await work.waitStarted()
    check(clock.seconds == 10, "budget is exactly ten seconds")
    clock.fire()
    check(
      probe.count == 1 && probe.title == nil, "never-responding work settles at controlled deadline"
    )
    check(coordinator.hasActiveWorker, "timed-out worker still owns concurrency slot")
    let skipped = DropEnrichmentRequest()
    let skippedProbe = Probe()
    skipped.observe { skippedProbe.receive($0) }
    let skippedTask = coordinator.begin(skipped, work: { DropLocalMetadata(title: "Must not run") })
    check(
      skippedTask == nil && skippedProbe.count == 1,
      "new imports fallback without accumulating workers")
    await work.reply(DropLocalMetadata(title: "Late title", jpeg: Data([1])))
    await task?.value
    check(probe.count == 1 && probe.title == nil, "late result cannot replace timeout fallback")
    check(!coordinator.hasActiveWorker, "slot released only when native worker actually ends")
    let next = try await coordinator.run {
      DropLocalMetadata(title: "Título 東京", artist: "Artist", year: 2024)
    }
    check(
      next.title == "Título 東京" && next.artist == "Artist" && next.year == 2024,
      "success preserves Unicode and descriptive fields")
    let error = try await coordinator.run { throw CocoaError(.fileReadUnknown) }
    check(error.title == nil, "optional extraction failure returns fallback")
    let cancel = DropEnrichmentRequest()
    let cancelProbe = Probe()
    let cancelWork = Work()
    let cancelClock = Clock()
    cancel.observe { cancelProbe.receive($0) }
    let cancelledTask = coordinator.begin(
      cancel, work: { try await cancelWork.run() }, schedule: { cancelClock.schedule($0, $1) })
    await cancelWork.waitStarted()
    cancel.cancel()
    check(cancelProbe.cancelled, "cancellation during extraction settles immediately")
    cancelClock.fire()
    await cancelWork.reply(DropLocalMetadata(title: "Cancelled late"))
    await cancelledTask?.value
    check(
      cancelProbe.count == 1 && cancelProbe.cancelled,
      "late callback and timeout cannot override cancellation")
    let duplicate = DropEnrichmentRequest()
    let duplicateProbe = Probe()
    duplicate.observe { duplicateProbe.receive($0) }
    duplicate.finish(.success(DropLocalMetadata(title: "First")))
    duplicate.finish(.success(DropLocalMetadata(title: "Second")))
    check(
      duplicateProbe.count == 1 && duplicateProbe.title == "First",
      "duplicate completion exactly once")
    let before = DropEnrichmentRequest()
    let beforeProbe = Probe()
    before.cancel()
    before.observe { beforeProbe.receive($0) }
    check(
      coordinator.begin(before, work: { DropLocalMetadata() }) == nil && beforeProbe.cancelled,
      "cancel before registration prevents work")
    let callerCoordinator = DropLocalImportEnrichment()
    let callerWork = Work()
    let caller = Task { try await callerCoordinator.run { try await callerWork.run() } }
    await callerWork.waitStarted()
    caller.cancel()
    do {
      _ = try await caller.value
      check(false, "caller task cancellation propagates through run")
    } catch is CancellationError { check(true, "caller task cancellation propagates through run") }
    check(
      callerCoordinator.hasActiveWorker,
      "caller cancellation does not falsely release framework worker")
    await callerWork.reply(DropLocalMetadata(title: "Ignored after caller cancellation"))
    print("FAILURES \(failures)")
    if failures > 0 { exit(1) }
  }
}
