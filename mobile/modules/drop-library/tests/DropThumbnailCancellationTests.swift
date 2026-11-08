import Foundation

// Controlled callback orders exercise the same request used by the AVFoundation adapter.
enum DropThumbnailCancellationTests {
  enum Failure: Error { case sample }
  final class Probe: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [Result<Data, Error>] = []
    private var stops = 0
    func receive(_ result: Result<Data, Error>) { lock.lock(); responses.append(result); lock.unlock() }
    func stop() { lock.lock(); stops += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return responses.count }
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return responses.count == 1 && responses.contains { if case .failure(is CancellationError) = $0 { return true }; return false } }
    var stopCount: Int { lock.lock(); defer { lock.unlock() }; return stops }
  }
  static func run() -> [(String, Bool)] {
    let success: Result<Data, Error> = .success(Data([1]))
    var checks: [(String, Bool)] = []
    func request() -> (DropThumbnailRequest, Probe) {
      let probe = Probe();return (DropThumbnailRequest(stop: { probe.stop() }), probe)
    }
    do { let (r,p)=request();r.cancel();r.observe { p.receive($0) };checks.append(("cancel before registration retained",p.cancelled && r.isFinished)) }
    do { let (r,p)=request();r.observe { p.receive($0) };r.cancel();checks.append(("cancel immediately after registration",p.cancelled)) }
    do { let (r,p)=request();r.observe { p.receive($0) };r.cancel();checks.append(("in-flight generation without completion",p.cancelled && p.stopCount == 1)) }
    for error in [false,true] {
      let result: Result<Data, Error> = error ? .failure(Failure.sample) : success
      var ok=true
      for cancelFirst in [false,true] {
        let (r,p)=request();r.observe { p.receive($0) }
        if cancelFirst { r.cancel();r.finish(result);ok = ok && p.cancelled }
        else { r.finish(result);r.cancel();ok = ok && p.count == 1 }
      }
      checks.append((error ? "cancel/error both linearized orders" : "cancel/success both linearized orders",ok))
    }
    do { let (r,p)=request();r.observe { p.receive($0) };r.cancel();r.finish(success);checks.append(("late callback cannot publish",p.cancelled)) }
    do { let (r,p)=request();r.observe { p.receive($0) };r.finish(success);r.finish(success);checks.append(("duplicate callback exactly once",p.count == 1)) }
    do { let (r,p)=request();r.cancel();r.cancel();r.observe { p.receive($0) };checks.append(("missing framework callback still terminates",p.cancelled && p.stopCount == 1)) }
    do { let (a,p)=request();a.observe { p.receive($0) };a.cancel();let (b,q)=request();b.observe { q.receive($0) };a.finish(success);b.finish(success);checks.append(("successive request isolated from old callback",p.cancelled && q.count == 1)) }
    do { let (r,p)=request();r.observe { value in p.receive(value);r.finish(success) };r.cancel();checks.append(("reentrant completion outside lock",p.cancelled)) }
    let iterations=128
    for error in [false, true] {
      let results=Probe()
      let callback: Result<Data, Error> = error ? .failure(Failure.sample) : success
      DispatchQueue.concurrentPerform(iterations: iterations) { _ in
        let (r,p)=request();r.observe { p.receive($0) }
        DispatchQueue.concurrentPerform(iterations: 2) { n in
          if n == 0 { r.cancel() } else { r.finish(callback) }
        }
        if p.count == 1 { results.receive(success) }
      }
      checks.append(("concurrent \(error ? "error" : "success")/cancellation exactly once 128 requests",results.count == iterations))
    }
    return checks
  }
}
