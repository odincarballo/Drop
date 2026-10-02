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
    var expectedSource: String? = nil
  }

  private static let lock = NSLock()
  private static var steps: [Step] = []
  private static var seen: [String] = []
  private static var sources: [String] = []
  private static var mismatch: String?

  static func reset(_ value: [Step]) {
    lock.lock()
    steps = value
    seen = []
    sources = []
    mismatch = nil
    lock.unlock()
  }

  static func result() -> ([String], String?) {
    lock.lock()
    defer { lock.unlock() }
    return (seen, mismatch)
  }

  static func seenSources() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return sources
  }

  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host?.hasSuffix(".googlevideo.com") == true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let range = request.value(forHTTPHeaderField: "Range") ?? ""
    let source = request.url?.query == "sig=AUDIO-FRESH" ? "fresh-audio"
      : request.url?.query == "sig=AUDIO-OLD" ? "old-audio" : "video"
    Self.lock.lock()
    Self.seen.append(range)
    Self.sources.append(source)
    let step = Self.steps.isEmpty ? nil : Self.steps.removeFirst()
    if let step, step.range != range {
      Self.mismatch = "Expected \(step.range), got \(range)"
    }
    if let expected = step?.expectedSource, expected != source {
      Self.mismatch = "Expected source \(expected), got \(source)"
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
  private static let lock = NSLock()
  private static var refreshResponses: [String] = []
  private static var refreshDelay: TimeInterval = 0
  private static var refreshCalls = 0
  private static var refreshTimeouts: [TimeInterval] = []
  private static var onRefresh: (() -> Void)?

  static func configureRefresh(
    responses: [String] = [], delay: TimeInterval = 0,
    onRefresh: (() -> Void)? = nil
  ) {
    lock.lock()
    refreshResponses = responses
    refreshDelay = delay
    refreshCalls = 0
    refreshTimeouts = []
    self.onRefresh = onRefresh
    lock.unlock()
  }

  static func refreshResult() -> (Int, [TimeInterval]) {
    lock.lock()
    defer { lock.unlock() }
    return (refreshCalls, refreshTimeouts)
  }

  static func prepareAudioDownload(
    _ analysisID: String, formatId: String, completion: @escaping (String) -> Void
  ) { completion(descriptor(kind: "audio", formatId: formatId)) }

  static func prepareAudioDownload(
    _ analysisID: String, formatId: String, timeoutSeconds: TimeInterval,
    completion: @escaping (String) -> Void
  ) {
    lock.lock()
    refreshCalls += 1
    refreshTimeouts.append(timeoutSeconds)
    let response = refreshResponses.isEmpty
      ? descriptor(kind: "audio", formatId: formatId, fresh: true)
      : refreshResponses.removeFirst()
    let delay = refreshDelay
    let callback = onRefresh
    lock.unlock()
    callback?()
    if delay > 0 {
      DispatchQueue.global().asyncAfter(deadline: .now() + delay) { completion(response) }
    } else {
      completion(response)
    }
  }

  static func prepareVideoDownload(
    _ analysisID: String, formatId: String, completion: @escaping (String) -> Void
  ) { completion(descriptor(kind: "video", formatId: formatId)) }

  static func cancel() {}

  static func descriptor(
    kind: String, formatId: String, fresh: Bool = false,
    expectedBytes: Int = 6
  ) -> String {
    let record: [String: Any] = ["descriptor": [
      "url": "https://rr1.googlevideo.com/file?sig=\(kind == "video" ? "VIDEO" : fresh ? "AUDIO-FRESH" : "AUDIO-OLD")",
      "headers": [:], "fileName": "sample.\(kind == "audio" ? "m4a" : "mp4")",
      "formatId": formatId, "container": kind == "audio" ? "m4a" : "mp4",
      "codec": kind == "audio" ? "mp4a.40.2" : "avc1.4d401e",
      "expectedBytes": expectedBytes,
    ]]
    return String(data: try! JSONSerialization.data(withJSONObject: record), encoding: .utf8)!
  }

  static func error(_ code: String) -> String {
    "{\"error\":{\"code\":\"\(code)\"}}"
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
  static var lastVideoBytes: Data?
  static var lastAudioBytes: Data?
  func start(videoURL: URL, audioURL: URL, outputURL: URL,
             expectedDurationSeconds: Double, progress: @escaping (Double) -> Void,
             completion: @escaping (Result<MDAVMuxResult, MDAVMuxFailure>) -> Void) {
    DispatchQueue.global().async {
      do {
        Self.lastVideoBytes = try Data(contentsOf: videoURL)
        Self.lastAudioBytes = try Data(contentsOf: audioURL)
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

  private static func audioRange(
    start: Int, end: Int, bytes: String, fresh: Bool = false,
    mime: String = "audio/mp4", total: Int = 6
  ) -> ScriptedProtocol.Step {
    .init(
      range: start == 0 ? firstRange : secondRange,
      status: 206,
      headers: ["Content-Range": "bytes \(start)-\(end)/\(total)",
        "Content-Type": mime, "Content-Length": "\(bytes.utf8.count)"],
      body: Data(bytes.utf8), error: nil,
      expectedSource: fresh ? "fresh-audio" : "old-audio")
  }

  private static func audioForbidden(
    range: String = secondRange, fresh: Bool = false
  ) -> ScriptedProtocol.Step {
    .init(range: range, status: 403, headers: ["Content-Type": "text/plain"],
      body: Data(), error: nil,
      expectedSource: fresh ? "fresh-audio" : "old-audio")
  }

  private static func status(_ code: Int, retryAfter: String? = nil,
                             range: String = firstRange) -> ScriptedProtocol.Step {
    var headers = ["Content-Type": "text/plain"]
    if let retryAfter { headers["Retry-After"] = retryAfter }
    return .init(range: range, status: code, headers: headers,
      body: Data(), error: nil)
  }

  private static func runCombined(
    _ steps: [ScriptedProtocol.Step], cancelOnAudioRetry: Bool = false,
    refreshResponses: [String] = [], refreshDelay: TimeInterval = 0
  ) throws ->
    ([String: Any?], [String]) {
    ScriptedProtocol.reset(steps)
    MDPythonBridge.configureRefresh(responses: refreshResponses, delay: refreshDelay)
    MDAVMuxer.lastAudioBytes = nil
    MDAVMuxer.lastVideoBytes = nil
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
    if let uri = terminal["localUri"] as? String, let url = URL(string: uri) {
      MDAudioDownloadPolicy.removeWorkspace(url.deletingLastPathComponent())
    }
    return (terminal, seen)
  }

  private static func run(
    _ steps: [ScriptedProtocol.Step], audio: Bool = false,
    cancelOnRetry: Bool = false, cancelDuringRequest: Bool = false,
    budget: MDRangeRetryBudget? = nil,
    onRetry: (() -> Void)? = nil, rejectDNS: Bool = false,
    refreshResponses: [String] = [], refreshDelay: TimeInterval = 0,
    cancelOnRefresh: Bool = false,
    cancelDuringFreshRequest: Bool = false,
    expectedOutput: Data = Data("abcdef".utf8)
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
    MDPythonBridge.configureRefresh(
      responses: refreshResponses, delay: refreshDelay,
      onRefresh: cancelOnRefresh ? { manager.cancel() } : nil)
    let job = audio
      ? manager.start(analysisID: "fixture", formatID: "140", durationSeconds: 1,
          retryBudget: budget)
      : manager.startVideo(analysisID: "fixture", formatID: "134", retryBudget: budget)
    guard job != nil else { throw TestFailure.failed("Could not start transfer") }
    let deadline = Date().addingTimeInterval(8)
    var cancelledRequest = false
    while terminal == nil && Date() < deadline {
      if cancelDuringRequest && !cancelledRequest && !ScriptedProtocol.result().0.isEmpty {
        cancelledRequest = true
        manager.cancel()
      } else if cancelDuringFreshRequest && !cancelledRequest &&
                  ScriptedProtocol.seenSources().contains("fresh-audio") {
        cancelledRequest = true
        manager.cancel()
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    guard let terminal else { throw TestFailure.failed("Transfer never became terminal") }
    try assertTerminalCleanup(terminal)
    let (seen, mismatch) = ScriptedProtocol.result()
    if let mismatch { throw TestFailure.failed(mismatch) }
    if cancelDuringRequest || cancelOnRefresh || cancelDuringFreshRequest || budget != nil {
      RunLoop.current.run(until: Date().addingTimeInterval(max(0.4, refreshDelay + 0.2)))
      guard terminal["status"] as? String != "COMPLETED" else {
        throw TestFailure.failed("Late callback published a cancelled or expired job")
      }
    }
    if let uri = terminal["localUri"] as? String, let url = URL(string: uri) {
      guard try Data(contentsOf: url) == expectedOutput else {
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
    let (refreshedAudio, refreshRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
      audioRange(start: 0, end: 2, bytes: "UVW", fresh: true),
      audioRange(start: 3, end: 5, bytes: "XYZ", fresh: true),
    ], audio: true, expectedOutput: Data("UVWXYZ".utf8))
    let refreshTrace = (refreshedAudio["httpDiagnostics"] as? [String: Any])?["forbiddenAudioRefreshStages"] as? [String]
    guard refreshedAudio["status"] as? String == "COMPLETED",
          refreshRanges == [firstRange, secondRange, firstRange, secondRange],
          ScriptedProtocol.seenSources() == ["old-audio", "old-audio", "fresh-audio", "fresh-audio"],
          MDPythonBridge.refreshResult().0 == 1,
          refreshTrace?.contains("identity_confirmed") == true,
          refreshTrace?.contains("restarted_at_zero") == true,
          !(String(describing: refreshedAudio).contains("AUDIO-FRESH")) else {
      throw TestFailure.failed("Audio 403 refresh mixed old and fresh bytes or leaked a URL")
    }
    let (secondForbidden, secondForbiddenRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
      audioRange(start: 0, end: 2, bytes: "UVW", fresh: true),
      audioForbidden(fresh: true),
    ], audio: true)
    guard secondForbidden["errorCode"] as? String == "AUDIO_HTTP_FORBIDDEN",
          secondForbiddenRanges.count == 4,
          MDPythonBridge.refreshResult().0 == 1 else {
      throw TestFailure.failed("A second 403 caused another URL refresh")
    }
    for code in ["AUDIO_TRACK_CHANGED", "AUDIO_TRACK_AMBIGUOUS"] {
      let (rejected, requests) = try run([
        audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
      ], audio: true, refreshResponses: [MDPythonBridge.error(code)])
      guard rejected["errorCode"] as? String == code,
            requests.count == 2, MDPythonBridge.refreshResult().0 == 1 else {
        throw TestFailure.failed("Changed or ambiguous audio identity was accepted")
      }
    }
    let (oversizedFresh, oversizedRequests) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
    ], audio: true, refreshResponses: [MDPythonBridge.descriptor(
      kind: "audio", formatId: "140", fresh: true, expectedBytes: 25 * 1024 * 1024 + 1)])
    guard oversizedFresh["errorCode"] as? String == "AUDIO_FILE_TOO_LARGE",
          oversizedRequests.count == 2 else {
      throw TestFailure.failed("Fresh URL bypassed the audio size limit")
    }
    let badFreshResponses: [(ScriptedProtocol.Step, String)] = [
      (audioRange(start: 0, end: 2, bytes: "UVW", fresh: true, mime: "text/plain"),
        "AUDIO_MIME_NOT_ALLOWED"),
      (.init(range: firstRange, status: 206,
        headers: ["Content-Range": "bytes 1-2/6", "Content-Length": "2",
          "Content-Type": "audio/mp4"], body: Data("VW".utf8), error: nil,
        expectedSource: "fresh-audio"), "AUDIO_RANGE_INVALID"),
    ]
    for (badFresh, code) in badFreshResponses {
      let (invalid, requests) = try run([
        audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(), badFresh,
      ], audio: true)
      guard invalid["errorCode"] as? String == code, requests.count == 3 else {
        throw TestFailure.failed("Fresh URL bypassed MIME or Content-Range validation")
      }
    }
    let (changedTotal, changedTotalRequests) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
      audioRange(start: 0, end: 2, bytes: "UVW", fresh: true),
      audioRange(start: 3, end: 5, bytes: "XYZ", fresh: true, total: 7),
    ], audio: true)
    guard changedTotal["errorCode"] as? String == "AUDIO_RANGE_INVALID",
          changedTotalRequests.count == 4 else {
      throw TestFailure.failed("Contradictory fresh total was accepted")
    }
    let (cancelledRefresh, cancelledRefreshRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
    ], audio: true, refreshDelay: 0.15, cancelOnRefresh: true)
    guard cancelledRefresh["status"] as? String == "CANCELLED",
          cancelledRefreshRanges.count == 2 else {
      throw TestFailure.failed("Cancellation during reextraction was ignored")
    }
    var delayedFresh = audioRange(start: 0, end: 2, bytes: "UVW", fresh: true)
    delayedFresh.delay = 0.3
    let (cancelledFresh, cancelledFreshRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(), delayedFresh,
    ], audio: true, cancelDuringFreshRequest: true)
    guard cancelledFresh["status"] as? String == "CANCELLED",
          cancelledFreshRanges.count == 3 else {
      throw TestFailure.failed("Cancellation during fresh transfer published a file")
    }
    let shortBudget = MDRangeRetryBudget(recoverySeconds: 0.15)
    let (refreshTimedOut, timedOutRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
    ], audio: true, budget: shortBudget, refreshDelay: 0.4)
    guard refreshTimedOut["errorCode"] as? String == "AUDIO_RECOVERY_BUDGET_EXHAUSTED",
          timedOutRanges.count == 2,
          MDPythonBridge.refreshResult().1.first.map({ $0 > 0 && $0 <= 0.15 }) == true else {
      throw TestFailure.failed("Python refresh outlived the shared time budget")
    }
    let spentBudget = MDRangeRetryBudget()
    for _ in 0..<4 {
      guard spentBudget.reserve(perRangeRetries: 0, delay: 0) else {
        throw TestFailure.failed("Could not construct exhausted shared budget")
      }
    }
    let (refreshDenied, deniedRanges) = try run([
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
    ], audio: true, budget: spentBudget)
    guard refreshDenied["status"] as? String == "FAILED",
          deniedRanges.count == 2, MDPythonBridge.refreshResult().0 == 0 else {
      throw TestFailure.failed("Refresh ignored the four-retry job budget")
    }
    let (combinedFresh, combinedFreshRanges) = try runCombined([
      first(), second(),
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
      audioRange(start: 0, end: 2, bytes: "UVW", fresh: true),
      audioRange(start: 3, end: 5, bytes: "XYZ", fresh: true),
    ])
    guard combinedFresh["status"] as? String == "COMPLETED",
          combinedFreshRanges.count == 6,
          ScriptedProtocol.seenSources() == ["video", "video", "old-audio", "old-audio", "fresh-audio", "fresh-audio"],
          MDAVMuxer.lastVideoBytes == Data("abcdef".utf8),
          MDAVMuxer.lastAudioBytes == Data("UVWXYZ".utf8),
          MDPythonBridge.refreshResult().0 == 1 else {
      throw TestFailure.failed("Combined recovery redownloaded video or mixed audio bytes")
    }
    let (combinedDenied, combinedDeniedRanges) = try runCombined([
      status(500), status(500), first(),
      status(500, range: secondRange), status(500, range: secondRange), second(),
      audioRange(start: 0, end: 2, bytes: "abc"), audioForbidden(),
    ])
    guard combinedDenied["status"] as? String == "FAILED",
          combinedDeniedRanges.count == 8,
          MDPythonBridge.refreshResult().0 == 0 else {
      throw TestFailure.failed("Audio refresh ignored retries already spent by video")
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
