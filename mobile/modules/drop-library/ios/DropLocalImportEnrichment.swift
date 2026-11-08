import Foundation

// Own logical completion; no task-group wait for an unresponsive framework worker.
final class DropEnrichmentRequest: @unchecked Sendable {
  typealias Reply = @Sendable (Result<DropLocalMetadata, Error>) -> Void
  private let lock = NSLock()
  private var reply: Reply?
  private var outcome: Result<DropLocalMetadata, Error>?
  private var finished = false
  private var worker: Task<Void, Never>?
  private var cancelTimer: (@Sendable () -> Void)?
  func observe(_ reply: @escaping Reply) {
    lock.lock()
    let result = outcome
    outcome = nil
    if !finished { self.reply = reply }
    lock.unlock()
    if let result { reply(result) }
  }
  func attach(_ task: Task<Void, Never>) {
    lock.lock()
    let stopped = finished
    if !stopped { worker = task }
    lock.unlock()
    if stopped { task.cancel() }
  }
  func timer(_ cancel: @escaping @Sendable () -> Void) {
    lock.lock()
    let stopped = finished
    if !stopped { cancelTimer = cancel }
    lock.unlock()
    if stopped { cancel() }
  }
  func finish(_ result: Result<DropLocalMetadata, Error>, cancel: Bool = false) {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    let callback = reply
    reply = nil
    if callback == nil { outcome = result }
    let task = worker
    worker = nil
    let timer = cancelTimer
    cancelTimer = nil
    lock.unlock()
    if cancel { task?.cancel() }
    timer?()
    callback?(result)
  }
  func cancel() { finish(.failure(CancellationError()), cancel: true) }
  var isFinished: Bool {
    lock.lock()
    defer { lock.unlock() }
    return finished
  }
}

final class DropLocalImportEnrichment: @unchecked Sendable {
  typealias Work = @Sendable () async throws -> DropLocalMetadata
  typealias Schedule = @Sendable (Double, @escaping @Sendable () -> Void) -> (@Sendable () -> Void)
  static let shared = DropLocalImportEnrichment()
  private let lock = NSLock()
  private var busy = false
  var hasActiveWorker: Bool {
    lock.lock()
    defer { lock.unlock() }
    return busy
  }
  @discardableResult
  func begin(
    _ request: DropEnrichmentRequest, work: @escaping Work,
    schedule: Schedule = { seconds, action in DropLocalImportEnrichment.schedule(seconds, action) }
  ) -> Task<Void, Never>? {
    guard !request.isFinished else { return nil }
    lock.lock()
    let occupied = busy
    if !occupied { busy = true }
    lock.unlock()
    if occupied {
      request.finish(.success(DropLocalMetadata(issues: [.busy])))
      return nil
    }
    let worker = Task.detached {
      let result: DropLocalMetadata
      do { result = try await work() } catch {
        result = DropLocalMetadata(issues: [.metadataUnavailable])
      }
      self.releaseWorker()
      request.finish(.success(result))
    }
    request.attach(worker)
    request.timer(
      schedule(10) {
        request.finish(.success(DropLocalMetadata(issues: [.metadataUnavailable])), cancel: true)
      })
    return worker
  }
  private func releaseWorker() {
    lock.lock()
    busy = false
    lock.unlock()
  }
  static func schedule(_ seconds: Double, _ action: @escaping @Sendable () -> Void)
    -> @Sendable () -> Void
  {
    let timer = Task {
      do {
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        action()
      } catch { /* Timer explicitly cancelled after completion. */  }
    }
    return { timer.cancel() }
  }
  func run(
    work: @escaping Work,
    schedule: Schedule = { seconds, action in DropLocalImportEnrichment.schedule(seconds, action) }
  ) async throws -> DropLocalMetadata {
    let request = DropEnrichmentRequest()
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        request.observe { continuation.resume(with: $0) }
        begin(request, work: work, schedule: schedule)
      }
    } onCancel: {
      request.cancel()
    }
  }
}
