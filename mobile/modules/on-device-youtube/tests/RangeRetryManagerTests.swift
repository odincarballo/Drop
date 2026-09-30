import Foundation

// This harness compiles the production transfer manager with a scripted URLProtocol.
// Only the Python preparation and AVFoundation finishing steps are replaced.
private enum TestFailure: Error { case failed(String) }

private final class ScriptedProtocol: URLProtocol {
  struct Step {
    let range: String
    let status: Int
    let headers: [String: String]
    let body: Data
    let error: URLError?
    var delay: TimeInterval = 0
  }

  private static let lock = NSLock()
  private static var steps: [Step] = []
  private static var seen: [String] = []
  private static var mismatch: String?

  static func reset(_ value: [Step]) {
    lock.lock()
    steps = value
    seen = []
    mismatch = nil
    lock.unlock()
  }

  static func result() -> ([String], String?) {
    lock.lock()
    defer { lock.unlock() }
    return (seen, mismatch)
  }

  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host?.hasSuffix(".googlevideo.com") == true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let range = request.value(forHTTPHeaderField: "Range") ?? ""
    Self.lock.lock()
    Self.seen.append(range)
    let step = Self.steps.isEmpty ? nil : Self.steps.removeFirst()
    if let step, step.range != range {
      Self.mismatch = "Expected \(step.range), got \(range)"
    }
    Self.lock.unlock()
    guard let step else {
      client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
      return
    }
    let deliver = {
      let response = HTTPURLResponse(
        url: self.request.url!, statusCode: step.status,
        httpVersion: "HTTP/1.1", headerFields: step.headers
      )!
      self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      if !step.body.isEmpty { self.client?.urlProtocol(self, didLoad: step.body) }
      if let error = step.error {
        self.client?.urlProtocol(self, didFailWithError: error)
      } else {
        self.client?.urlProtocolDidFinishLoading(self)
      }
    }
    if step.delay > 0 {
      DispatchQueue.global().asyncAfter(deadline: .now() + step.delay, execute: deliver)
    } else {
      deliver()
    }
  }

  override func stopLoading() {}
}

enum MDPythonBridge {
  static func prepareAudioDownload(
    _ analysisID: String, formatId: String, completion: @escaping (String) -> Void
  ) { completion(descriptor(kind: "audio", formatId: formatId)) }

  static func prepareVideoDownload(
    _ analysisID: String, formatId: String, completion: @escaping (String) -> Void
  ) { completion(descriptor(kind: "video", formatId: formatId)) }

  static func cancel() {}

  private static func descriptor(kind: String, formatId: String) -> String {
    let record: [String: Any] = ["descriptor": [
      "url": "https://rr1.googlevideo.com/file?sig=SECRET",
      "headers": [:], "fileName": "sample.\(kind == "audio" ? "m4a" : "mp4")",
      "formatId": formatId, "container": kind == "audio" ? "m4a" : "mp4",
      "codec": kind == "audio" ? "mp4a.40.2" : "avc1.4d401e",
      "expectedBytes": 6,
    ]]
    return String(data: try! JSONSerialization.data(withJSONObject: record), encoding: .utf8)!
  }
}

struct MDAVAudioNormalizationResult { let fileSize: Int64 }
enum MDAudioNormalizationFailure: Error {
  case code(String)
  var code: String {
    switch self { case .code(let value): return value }
  }
}
final class MDAVAudioNormalizer {
  func start(inputURL: URL, outputURL: URL, expectedDurationSeconds: Double,
             completion: @escaping (Result<MDAVAudioNormalizationResult,
               MDAudioNormalizationFailure>) -> Void) {
    DispatchQueue.global().async {
      do {
        try FileManager.default.copyItem(at: inputURL, to: outputURL)
        completion(.success(MDAVAudioNormalizationResult(fileSize: 6)))
      } catch {
        completion(.failure(.code("AUDIO_NORMALIZATION_EXPORT_FAILED")))
      }
    }
  }
  func cancel() {}
}

enum MDAVMuxFailure: Error {
  case code(String)
  var code: String { switch self { case .code(let value): return value } }
}
struct MDAVMuxResult { let fileSize: Int64; let durationSeconds: Double }
enum MDAVMuxPolicy {
  static func validatedDuration(_ seconds: Double) throws -> Double { seconds }
}
final class MDAVMuxer {
  func start(videoURL: URL, audioURL: URL, outputURL: URL,
             expectedDurationSeconds: Double, progress: @escaping (Double) -> Void,
             completion: @escaping (Result<MDAVMuxResult, MDAVMuxFailure>) -> Void) {
    DispatchQueue.global().async {
      do {
        try FileManager.default.copyItem(at: videoURL, to: outputURL)
        completion(.success(MDAVMuxResult(fileSize: 6,
          durationSeconds: expectedDurationSeconds)))
      } catch { completion(.failure(.code("MUX_EXPORT_FAILED"))) }
    }
  }
  func cancel() {}
}

@main
enum RangeRetryManagerTests {
  private static let firstRange = "bytes=0-262143"
  private static let secondRange = "bytes=3-5"

  private static func partial(_ error: URLError) -> ScriptedProtocol.Step {
    .init(range: firstRange, status: 206,
      headers: ["Content-Range": "bytes 0-2/6", "Content-Type": "video/mp4",
        "Content-Length": "3"], body: Data("a".utf8), error: error)
  }

  private static func first(_ mime: String = "video/mp4") -> ScriptedProtocol.Step {
    .init(range: firstRange, status: 206,
      headers: ["Content-Range": "bytes 0-2/6", "Content-Type": mime,
        "Content-Length": "3", "ETag": "\"fixed\""],
      body: Data("abc".utf8), error: nil)
  }

  private static func second(_ mime: String = "video/mp4") -> ScriptedProtocol.Step {
    .init(range: secondRange, status: 206,
      headers: ["Content-Range": "bytes 3-5/6", "Content-Type": mime,
        "Content-Length": "3", "ETag": "\"fixed\""],
      body: Data("def".utf8), error: nil)
  }

  private static func status(_ code: Int, retryAfter: String? = nil,
                             range: String = firstRange) -> ScriptedProtocol.Step {
    var headers = ["Content-Type": "text/plain"]
    if let retryAfter { headers["Retry-After"] = retryAfter }
    return .init(range: range, status: code, headers: headers,
      body: Data(), error: nil)
  }

  private static func runCombined(
    _ steps: [ScriptedProtocol.Step], cancelOnAudioRetry: Bool = false
  ) throws ->
    ([String: Any?], [String]) {
    ScriptedProtocol.reset(steps)
    var terminal: [String: Any?]?
    var manager: MDCombinedDownloadManager!
    manager = MDCombinedDownloadManager(
      emitEvent: { event in
        if cancelOnAudioRetry && event["status"] as? String == "RETRYING_AUDIO" {
          manager.cancel()
        }
        if ["COMPLETED", "FAILED", "CANCELLED"].contains(event["status"] as? String ?? "") {
          terminal = event
        }
      },
      makeSessionConfiguration: {
        let value = URLSessionConfiguration.ephemeral
        value.protocolClasses = [ScriptedProtocol.self]
        return value
      },
      validateTransferURL: { url, kind in
        try MDAudioDownloadPolicy.validateURL(url, kind: kind, resolveDNS: false)
      }
    )
    guard manager.start(analysisID: "fixture", videoFormatID: "134",
                        audioFormatID: "140", expectedDurationSeconds: 1) != nil else {
      throw TestFailure.failed("Combined job could not start")
    }
    let deadline = Date().addingTimeInterval(12)
    while terminal == nil && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    guard let terminal else { throw TestFailure.failed("Combined job did not finish") }
    try assertTerminalCleanup(terminal)
    let (seen, mismatch) = ScriptedProtocol.result()
    if let mismatch { throw TestFailure.failed(mismatch) }
    return (terminal, seen)
  }

  private static func run(
    _ steps: [ScriptedProtocol.Step], audio: Bool = false,
    cancelOnRetry: Bool = false, cancelDuringRequest: Bool = false,
    budget: MDRangeRetryBudget? = nil,
    onRetry: (() -> Void)? = nil, rejectDNS: Bool = false
  ) throws -> ([String: Any?], [String]) {
    ScriptedProtocol.reset(steps)
    var terminal: [String: Any?]?
    let configuration = { () -> URLSessionConfiguration in
      let value = URLSessionConfiguration.ephemeral
      value.protocolClasses = [ScriptedProtocol.self]
      return value
    }
    var manager: MDAudioDownloadManager!
    manager = MDAudioDownloadManager(
      emitEvent: { event in
        if event["status"] as? String == "RETRYING" {
          onRetry?()
          if cancelOnRetry { manager.cancel() }
        }
        if ["COMPLETED", "FAILED", "CANCELLED"].contains(event["status"] as? String ?? "") {
          terminal = event
        }
      },
      makeSessionConfiguration: configuration,
      validateTransferURL: { url, kind in
        if rejectDNS { throw MDAudioDownloadFailure.code("VIDEO_DNS_INVALID") }
        try MDAudioDownloadPolicy.validateURL(url, kind: kind, resolveDNS: false)
      }
    )
    let job = audio
      ? manager.start(analysisID: "fixture", formatID: "140", durationSeconds: 1)
      : manager.startVideo(analysisID: "fixture", formatID: "134", retryBudget: budget)
    guard job != nil else { throw TestFailure.failed("Could not start transfer") }
    let deadline = Date().addingTimeInterval(8)
    var cancelledRequest = false
    while terminal == nil && Date() < deadline {
      if cancelDuringRequest && !cancelledRequest && !ScriptedProtocol.result().0.isEmpty {
        cancelledRequest = true
        manager.cancel()
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    guard let terminal else { throw TestFailure.failed("Transfer never became terminal") }
    try assertTerminalCleanup(terminal)
    let (seen, mismatch) = ScriptedProtocol.result()
    if let mismatch { throw TestFailure.failed(mismatch) }
    if cancelDuringRequest || budget != nil {
      RunLoop.current.run(until: Date().addingTimeInterval(0.4))
      guard terminal["status"] as? String != "COMPLETED" else {
        throw TestFailure.failed("Late callback published a cancelled or expired job")
      }
    }
    if let uri = terminal["localUri"] as? String, let url = URL(string: uri) {
      guard try Data(contentsOf: url) == Data("abcdef".utf8) else {
        throw TestFailure.failed("Verified output duplicated or lost bytes")
      }
      MDAudioDownloadPolicy.removeWorkspace(url.deletingLastPathComponent())
    }
    return (terminal, seen)
  }

  private static func assertTerminalCleanup(_ terminal: [String: Any?]) throws {
    guard terminal["status"] as? String != "COMPLETED" else { return }
    guard terminal["localUri"] == nil,
          let jobID = terminal["jobId"] as? String,
          UUID(uuidString: jobID) != nil,
          let caches = FileManager.default.urls(for: .cachesDirectory,
            in: .userDomainMask).first else {
      throw TestFailure.failed("Failed or cancelled job exposed a file")
    }
    let workspace = caches.appendingPathComponent("MediaDrop", isDirectory: true)
      .appendingPathComponent(jobID, isDirectory: true)
    guard !FileManager.default.fileExists(atPath: workspace.path) else {
      throw TestFailure.failed("Failed or cancelled job left its workspace")
    }
  }

  static func main() throws {
    let (recovered, ranges) = try run([
      partial(URLError(.networkConnectionLost)), first(), second(),
    ])
    guard recovered["status"] as? String == "COMPLETED",
          ranges == [firstRange, firstRange, secondRange] else {
      throw TestFailure.failed("Intermediate range was not retried exactly once")
    }
    let (timeout, timeoutRanges) = try run([
      partial(URLError(.timedOut)), first(), second(),
    ])
    guard timeout["status"] as? String == "COMPLETED", timeoutRanges.count == 3 else {
      throw TestFailure.failed("Timeout was not retried")
    }
    let incomplete = ScriptedProtocol.Step(range: firstRange, status: 206,
      headers: ["Content-Range": "bytes 0-2/6", "Content-Type": "video/mp4",
        "Content-Length": "3"], body: Data("a".utf8), error: nil)
    let (short, shortRanges) = try run([incomplete, first(), second()])
    guard short["status"] as? String == "COMPLETED", shortRanges.count == 3 else {
      throw TestFailure.failed("Incomplete 206 range was not safely retried")
    }
    let (audio, audioRanges) = try run([
      .init(range: firstRange, status: 206,
        headers: ["Content-Range": "bytes 0-2/6", "Content-Type": "audio/mp4",
          "Content-Length": "3"], body: Data("abc".utf8), error: nil),
      .init(range: secondRange, status: 206,
        headers: ["Content-Range": "bytes 3-5/6", "Content-Type": "audio/mp4",
          "Content-Length": "3"], body: Data("def".utf8), error: nil),
    ], audio: true)
    guard audio["status"] as? String == "COMPLETED",
          audioRanges == [firstRange, secondRange] else {
      throw TestFailure.failed("Standalone audio did not use ranges")
    }
    let (audioRecovered, audioRetryRanges) = try run([
      status(500), first("audio/mp4"), second("audio/mp4"),
    ], audio: true)
    guard audioRecovered["status"] as? String == "COMPLETED",
          audioRetryRanges == [firstRange, firstRange, secondRange] else {
      throw TestFailure.failed("Standalone audio did not reuse range retry")
    }
    for code in [408, 500, 502, 503, 504] {
      let (event, seen) = try run([status(code), first(), second()])
      guard event["status"] as? String == "COMPLETED", seen.count == 3 else {
        throw TestFailure.failed("HTTP \(code) was not retried")
      }
    }
    for code in [403, 416, 429, 501, 505] {
      let (event, seen) = try run([status(code)])
      guard event["status"] as? String == "FAILED", seen.count == 1 else {
        throw TestFailure.failed("HTTP \(code) was retried incorrectly")
      }
    }
    for code in [URLError.secureConnectionFailed, .cannotFindHost] {
      let (event, seen) = try run([partial(URLError(code))])
      guard event["status"] as? String == "FAILED", seen.count == 1 else {
        throw TestFailure.failed("TLS or ambiguous DNS error was retried")
      }
    }
    let (dnsRejected, dnsRequests) = try run([], rejectDNS: true)
    guard dnsRejected["errorCode"] as? String == "VIDEO_DNS_INVALID",
          dnsRequests.isEmpty else {
      throw TestFailure.failed("DNS security rejection reached the retry engine")
    }
    let fullBodyPartial = ScriptedProtocol.Step(range: firstRange, status: 200,
      headers: ["Content-Type": "video/mp4", "Content-Length": "6"],
      body: Data("abc".utf8), error: URLError(.networkConnectionLost))
    let (fullBody, fullBodyRanges) = try run([fullBodyPartial])
    guard fullBody["status"] as? String == "FAILED", fullBodyRanges.count == 1 else {
      throw TestFailure.failed("Partial 200 fallback was retried or published")
    }
    let fullBodyComplete = ScriptedProtocol.Step(range: firstRange, status: 200,
      headers: ["Content-Type": "video/mp4", "Content-Length": "6"],
      body: Data("abcdef".utf8), error: nil)
    let (fallback, fallbackRanges) = try run([fullBodyComplete])
    guard fallback["status"] as? String == "COMPLETED", fallbackRanges.count == 1 else {
      throw TestFailure.failed("Existing initial HTTP 200 fallback regressed")
    }
    let (longWait, seenLong) = try run([status(503, retryAfter: "60")])
    guard longWait["errorCode"] as? String == "VIDEO_RETRY_AFTER_TOO_LONG",
          seenLong.count == 1 else {
      throw TestFailure.failed("Long Retry-After was ignored")
    }
    let (shortWait, seenShort) = try run([
      status(503, retryAfter: "0"), first(), second(),
    ])
    guard shortWait["status"] as? String == "COMPLETED", seenShort.count == 3 else {
      throw TestFailure.failed("Valid bounded Retry-After failed")
    }
    let (rateLimited, seenRateLimited) = try run([status(429, retryAfter: "0")])
    guard rateLimited["status"] as? String == "FAILED", seenRateLimited.count == 1 else {
      throw TestFailure.failed("429 with Retry-After was retried")
    }
    let (exhausted, exhaustedRanges) = try run([
      status(500), status(500), status(500),
    ])
    guard exhausted["errorCode"] as? String == "VIDEO_SERVER_RETRIES_EXHAUSTED",
          exhaustedRanges.count == 3 else {
      throw TestFailure.failed("Per-range retry maximum was not enforced")
    }
    let changedETag = ScriptedProtocol.Step(range: secondRange, status: 206,
      headers: ["Content-Range": "bytes 3-5/6", "Content-Length": "3",
        "Content-Type": "video/mp4", "ETag": "\"changed\""],
      body: Data("def".utf8), error: nil)
    let (identityFailed, identityRanges) = try run([first(), changedETag])
    guard identityFailed["status"] as? String == "FAILED", identityRanges.count == 2 else {
      throw TestFailure.failed("Changed ETag did not stop transfer")
    }
    let wrongRange = ScriptedProtocol.Step(range: secondRange, status: 206,
      headers: ["Content-Range": "bytes 4-5/6", "Content-Length": "2",
        "Content-Type": "video/mp4"], body: Data("ef".utf8), error: nil)
    let (rangeRejected, rangeRejectedRequests) = try run([first(), wrongRange])
    guard rangeRejected["errorCode"] as? String == "VIDEO_RANGE_INVALID",
          rangeRejectedRequests.count == 2 else {
      throw TestFailure.failed("Contradictory Content-Range was retried")
    }
    let noETagFirst = ScriptedProtocol.Step(range: firstRange, status: 206,
      headers: ["Content-Range": "bytes 0-2/6", "Content-Length": "3",
        "Content-Type": "video/mp4"], body: Data("abc".utf8), error: nil)
    let noETagSecond = ScriptedProtocol.Step(range: secondRange, status: 206,
      headers: ["Content-Range": "bytes 3-5/6", "Content-Length": "3",
        "Content-Type": "video/mp4"], body: Data("def".utf8), error: nil)
    let (noETag, noETagRanges) = try run([noETagFirst, noETagSecond])
    guard noETag["status"] as? String == "COMPLETED", noETagRanges.count == 2 else {
      throw TestFailure.failed("Server without ETag was rejected")
    }
    let (combined, combinedRanges) = try runCombined([
      status(500), status(500), first(),
      status(500, range: secondRange), second(),
      status(500), first("audio/mp4"),
      status(500, range: secondRange),
    ])
    guard combined["errorCode"] as? String == "AUDIO_SERVER_RETRIES_EXHAUSTED",
          combinedRanges.count == 8 else {
      throw TestFailure.failed("Video and audio did not share four global retries")
    }
    let (combinedCancelled, cancelledRanges) = try runCombined([
      first(), second(), status(500),
    ], cancelOnAudioRetry: true)
    guard combinedCancelled["status"] as? String == "CANCELLED",
          cancelledRanges.count == 3 else {
      throw TestFailure.failed("Combined audio retry ignored cancellation")
    }
    let (cancelled, seenCancelled) = try run([status(500)], cancelOnRetry: true)
    guard cancelled["status"] as? String == "CANCELLED", seenCancelled.count == 1 else {
      throw TestFailure.failed("Backoff cancellation started another request")
    }
    var delayed = first()
    delayed.delay = 0.3
    let (cancelledInRequest, seenRequest) = try run([delayed], cancelDuringRequest: true)
    guard cancelledInRequest["status"] as? String == "CANCELLED", seenRequest.count == 1 else {
      throw TestFailure.failed("Cancellation during a request published late data")
    }
    var slowRecovery = first()
    slowRecovery.delay = 0.6
    let (expired, expiredRanges) = try run(
      [status(500), slowRecovery],
      budget: MDRangeRetryBudget(recoverySeconds: 0.7)
    )
    guard expired["errorCode"] as? String == "VIDEO_RECOVERY_BUDGET_EXHAUSTED",
          expiredRanges.count == 2 else {
      throw TestFailure.failed("Recovery request outlived its shared deadline")
    }
    var clock: TimeInterval = 100
    let (expiredBackoff, backoffRanges) = try run(
      [status(500)],
      budget: MDRangeRetryBudget(now: { clock }),
      onRetry: { clock = 131 }
    )
    guard expiredBackoff["errorCode"] as? String == "VIDEO_RECOVERY_BUDGET_EXHAUSTED",
          backoffRanges.count == 1 else {
      throw TestFailure.failed("Expired backoff issued another request")
    }
    print("RangeRetryManagerTests: passed")
  }
}
