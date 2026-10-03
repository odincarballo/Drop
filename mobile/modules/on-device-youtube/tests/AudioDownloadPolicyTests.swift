import Foundation

private enum TestFailure: Error { case failed(String) }

private func expectFailure(_ code: String, _ operation: () throws -> Void) throws {
  do {
    try operation()
    throw TestFailure.failed("Expected \(code)")
  } catch let failure as MDAudioDownloadFailure {
    guard failure.code == code else {
      throw TestFailure.failed("Expected \(code), received \(failure.code)")
    }
  }
}

@main
enum AudioDownloadPolicyTests {
  static func main() throws {
    guard
      MDAudioDownloadPolicy.requestTimeoutSeconds == 60,
      MDAudioDownloadPolicy.resourceTimeoutSeconds == 300,
      MDAudioDownloadPolicy.standaloneAudioUsesRanges
    else {
      throw TestFailure.failed("Download timeouts must remain finite")
    }
    try MDAudioDownloadPolicy.validateURL(
      URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      resolveDNS: false
    )
    for invalid in [
      "http://rr1.googlevideo.com/file",
      "https://127.0.0.1/file",
      "https://googlevideo.com.evil.test/file",
      "https://user:password@rr1.googlevideo.com/file",
      "https://rr1.googlevideo.com:8443/file",
    ] {
      try expectFailure("AUDIO_URL_INVALID") {
        try MDAudioDownloadPolicy.validateURL(URL(string: invalid)!, resolveDNS: false)
      }
    }
    try expectFailure("VIDEO_URL_INVALID") {
      try MDAudioDownloadPolicy.validateURL(
        URL(string: "https://youtube.com.evil.test/file")!,
        kind: .video,
        resolveDNS: false
      )
    }
    _ = try MDAudioDownloadPolicy.validateHeaders([
      "User-Agent": "MediaDrop", "Accept-Language": "es",
    ])
    try expectFailure("AUDIO_HEADERS_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateHeaders(["Cookie": "secret"])
    }
    try expectFailure("AUDIO_HEADERS_INVALID") {
      _ = try MDAudioDownloadPolicy.validateHeaders(["X-Unknown": "value"])
    }
    try expectFailure("VIDEO_HEADERS_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateHeaders(
        ["Authorization": "secret"],
        kind: .video
      )
    }
    try expectFailure("AUDIO_FILE_TOO_LARGE") {
      try MDAudioDownloadPolicy.validateExpectedLength(
        MDAudioDownloadPolicy.maximumBytes + 1
      )
    }
    try expectFailure("VIDEO_FILE_TOO_LARGE") {
      try MDAudioDownloadPolicy.validateExpectedLength(
        MDAudioDownloadPolicy.maximumVideoBytes + 1,
        maximumBytes: MDAudioDownloadPolicy.maximumVideoBytes
      )
    }
    try MDAudioDownloadPolicy.validateExpectedLength(
      MDAudioDownloadPolicy.maximumStandardVideoBytes,
      maximumBytes: MDAudioDownloadPolicy.maximumStandardVideoBytes)
    try expectFailure("VIDEO_FILE_TOO_LARGE") {
      try MDAudioDownloadPolicy.validateExpectedLength(
        MDAudioDownloadPolicy.maximumStandardVideoBytes + 1,
        maximumBytes: MDAudioDownloadPolicy.maximumStandardVideoBytes)
    }
    let videoResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "video/mp4", "Content-Length": "5000000"]
    )!
    try MDAudioDownloadPolicy.validateResponse(videoResponse, kind: .video)
    guard
      MDAudioDownloadPolicy.parseVideoContentRange("bytes 0-262143/586796")
        == MDVideoContentRange(start: 0, end: 262143, total: 586796),
      MDAudioDownloadPolicy.parseVideoContentRange("bytes */586796") == nil,
      MDAudioDownloadPolicy.parseVideoContentRange("bytes 2-1/586796") == nil
    else {
      throw TestFailure.failed("Video Content-Range parsing failed")
    }
    let rangedVideoResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 206,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "video/mp4",
        "Content-Length": "262144",
        "Content-Range": "bytes 0-262143/586796",
      ]
    )!
    let range = try MDAudioDownloadPolicy.validateVideoRangeResponse(
      rangedVideoResponse,
      requestedStart: 0,
      requestedEnd: 262143
    )
    guard range.total == 586796 else {
      throw TestFailure.failed("Video total length was not recovered")
    }
    let oversizedRange = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 206,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "video/mp4",
        "Content-Length": "262144",
        "Content-Range": "bytes 0-262143/\(MDAudioDownloadPolicy.maximumStandardVideoBytes + 1)",
      ]
    )!
    try expectFailure("VIDEO_FILE_TOO_LARGE") {
      _ = try MDAudioDownloadPolicy.validateRangeResponse(
        oversizedRange, requestedStart: 0, requestedEnd: 262143,
        kind: .video,
        maximumBytes: MDAudioDownloadPolicy.maximumStandardVideoBytes)
    }
    try expectFailure("VIDEO_RANGE_NOT_SUPPORTED") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        videoResponse,
        requestedStart: 0,
        requestedEnd: 262143
      )
    }
    let fullBodyVideoResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "video/mp4",
        "Content-Length": "586796",
      ]
    )!
    guard
      try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        fullBodyVideoResponse,
        requestedStart: 0,
        bytesAlreadyPersisted: 0,
        kind: .video
      ) == 586796
    else {
      throw TestFailure.failed("Full-body video fallback length was not recovered")
    }
    let oversizedFullBodyResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "video/mp4",
        "Content-Length": "\(MDAudioDownloadPolicy.maximumVideoBytes + 1)",
      ]
    )!
    try expectFailure("VIDEO_FILE_TOO_LARGE") {
      _ = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        oversizedFullBodyResponse,
        requestedStart: 0,
        bytesAlreadyPersisted: 0,
        kind: .video
      )
    }
    try expectFailure("VIDEO_RANGE_NOT_SUPPORTED") {
      _ = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        fullBodyVideoResponse,
        requestedStart: 262144,
        bytesAlreadyPersisted: 262144,
        kind: .video
      )
    }
    let forbiddenRangeResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 403,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "video/mp4"]
    )!
    try expectFailure("VIDEO_HTTP_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        forbiddenRangeResponse,
        requestedStart: 0,
        requestedEnd: 262143
      )
    }
    let rejectedRangeResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 416,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "video/mp4"]
    )!
    try expectFailure("VIDEO_RANGE_REJECTED") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        rejectedRangeResponse,
        requestedStart: 0,
        requestedEnd: 262143
      )
    }
    guard
      MDAudioDownloadPolicy.rangeFailureCode(429, kind: .video) == "VIDEO_RATE_LIMITED",
      MDAudioDownloadPolicy.rangeFailureCode(503, kind: .video) == "VIDEO_HTTP_ERROR"
    else {
      throw TestFailure.failed("Non-200 HTTP statuses must not enter the fallback")
    }
    try expectFailure("VIDEO_RANGE_INVALID") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        rangedVideoResponse,
        requestedStart: 262144,
        requestedEnd: 524287
      )
    }
    let rangedAudioResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 206,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "audio/mp4",
        "Content-Length": "262144",
        "Content-Range": "bytes 0-262143/2073130",
      ]
    )!
    let audioRange = try MDAudioDownloadPolicy.validateRangeResponse(
      rangedAudioResponse,
      requestedStart: 0,
      requestedEnd: 262143,
      kind: .audio
    )
    guard audioRange.total == 2073130 else {
      throw TestFailure.failed("Audio total length was not recovered")
    }
    let fullBodyAudioResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "audio/mp4",
        "Content-Length": "2073130",
      ]
    )!
    guard
      try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        fullBodyAudioResponse,
        requestedStart: 0,
        bytesAlreadyPersisted: 0,
        kind: .audio
      ) == 2073130
    else {
      throw TestFailure.failed("Audio full-body fallback length was not recovered")
    }
    try expectFailure("AUDIO_RANGE_NOT_SUPPORTED") {
      _ = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        fullBodyAudioResponse,
        requestedStart: 262144,
        bytesAlreadyPersisted: 262144,
        kind: .audio
      )
    }
    let forbiddenAudioResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 403,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "audio/mp4"]
    )!
    try expectFailure("AUDIO_HTTP_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        forbiddenAudioResponse,
        requestedStart: 0,
        bytesAlreadyPersisted: 0,
        kind: .audio
      )
    }
    try expectFailure("AUDIO_HTTP_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateRangeResponse(
        forbiddenAudioResponse,
        requestedStart: 0,
        requestedEnd: 262143,
        kind: .audio
      )
    }
    let unsatisfiableAudioResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 416,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Range": "bytes */2073130"]
    )!
    try expectFailure("AUDIO_RANGE_REJECTED") {
      _ = try MDAudioDownloadPolicy.validateRangeResponse(
        unsatisfiableAudioResponse,
        requestedStart: 0,
        requestedEnd: 262143,
        kind: .audio
      )
    }
    let oversizedAudioResponse = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/videoplayback")!,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "audio/mp4",
        "Content-Length": "\(MDAudioDownloadPolicy.maximumBytes + 1)",
      ]
    )!
    try expectFailure("AUDIO_FILE_TOO_LARGE") {
      _ = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
        oversizedAudioResponse,
        requestedStart: 0,
        bytesAlreadyPersisted: 0,
        kind: .audio
      )
    }
    try expectFailure("AUDIO_RANGE_NOT_SUPPORTED") {
      _ = try MDAudioDownloadPolicy.validateRangeResponse(
        videoResponse,
        requestedStart: 0,
        requestedEnd: 262143,
        kind: .audio
      )
    }
    guard
      MDAudioDownloadPolicy.safeFileName("../Own: video.mp4", extension: "mp4")
        == "_Own_ video.mp4"
    else {
      throw TestFailure.failed("Video filename sanitization failed")
    }
    try expectFailure("AUDIO_FILE_TOO_LARGE") {
      try MDAudioDownloadPolicy.validateTransferredBytes(
        MDAudioDownloadPolicy.maximumBytes + 1
      )
    }

    guard MDAudioDownloadPolicy.retryableHTTPStatuses == [408, 500, 502, 503, 504] else {
      throw TestFailure.failed("HTTP retry allowlist changed")
    }
    for status in [403, 416, 429, 501, 505] {
      guard !MDAudioDownloadPolicy.retryableHTTPStatuses.contains(status) else {
        throw TestFailure.failed("HTTP \(status) must not retry")
      }
    }
    for code in [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
      NSURLErrorCannotConnectToHost, NSURLErrorNotConnectedToInternet] {
      guard MDAudioDownloadPolicy.isRetryableTransport(
        NSError(domain: NSURLErrorDomain, code: code)) else {
        throw TestFailure.failed("Transient transport \(code) not retried")
      }
    }
    for code in [NSURLErrorCancelled, NSURLErrorCannotFindHost,
      NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted] {
      guard !MDAudioDownloadPolicy.isRetryableTransport(
        NSError(domain: NSURLErrorDomain, code: code)) else {
        throw TestFailure.failed("Security, DNS, or cancellation \(code) retried")
      }
    }
    guard MDAudioDownloadPolicy.retryAfterSeconds("4") == 4,
          MDAudioDownloadPolicy.retryAfterSeconds("429496729999999999999") == nil,
          MDAudioDownloadPolicy.retryAfterSeconds("4; token=SECRET") == nil,
          MDAudioDownloadPolicy.strongETag("\"stable\"") == "\"stable\"",
          MDAudioDownloadPolicy.strongETag("W/\"weak\"") == nil else {
      throw TestFailure.failed("Retry-After or strong ETag validation failed")
    }
    var instant: TimeInterval = 100
    let sharedBudget = MDRangeRetryBudget(now: { instant })
    guard sharedBudget.reserve(perRangeRetries: 0, delay: 0.5),
          sharedBudget.reserve(perRangeRetries: 1, delay: 1.5),
          !sharedBudget.reserve(perRangeRetries: 2, delay: 1.5),
          sharedBudget.reserve(perRangeRetries: 0, delay: 0.5),
          sharedBudget.reserve(perRangeRetries: 0, delay: 0.5),
          !sharedBudget.reserve(perRangeRetries: 0, delay: 0.5),
          sharedBudget.retriesUsed == 4 else {
      throw TestFailure.failed("Per-range or combined global retry budget failed")
    }
    instant = 131
    guard sharedBudget.secondsRemaining == 0 else {
      throw TestFailure.failed("Monotonic recovery deadline failed")
    }
    let temporalBudget = MDRangeRetryBudget(now: { instant })
    guard !temporalBudget.reserve(perRangeRetries: 0, delay: 31),
          temporalBudget.retriesUsed == 0,
          temporalBudget.secondsRemaining == 30 else {
      throw TestFailure.failed("Long Retry-After bypassed the time budget")
    }
    instant += 30
    guard !temporalBudget.reserve(perRangeRetries: 0, delay: 0.5) else {
      throw TestFailure.failed("Expired backoff budget allowed a retry")
    }
    instant = 200
    let forbiddenBudget = MDRangeRetryBudget(now: { instant })
    guard forbiddenBudget.reserveAudioForbiddenRefresh(),
          forbiddenBudget.retriesUsed == 1,
          forbiddenBudget.secondsRemaining == 30 else {
      throw TestFailure.failed("Audio 403 refresh did not start the shared budget")
    }
    instant = 229
    guard forbiddenBudget.reserve(perRangeRetries: 0, delay: 0.5),
          forbiddenBudget.secondsRemaining == 1 else {
      throw TestFailure.failed("Normal range retry did not share the refresh deadline")
    }
    instant = 230
    guard !forbiddenBudget.reserveAudioForbiddenRefresh() else {
      throw TestFailure.failed("Audio 403 refresh extended an expired deadline")
    }
    let identityRange = MDVideoContentRange(start: 0, end: 99, total: 200)
    let sameETag = HTTPURLResponse(
      url: URL(string: "https://rr1.googlevideo.com/file")!, statusCode: 206,
      httpVersion: nil, headerFields: [
        "Content-Range": "bytes 0-99/200", "Content-Length": "100", "ETag": "\"same\"",
      ])!
    try MDAudioDownloadPolicy.validateRangeIdentity(
      identityRange, response: sameETag, previousTotal: 200,
      previousStrongETag: "\"same\"", kind: .audio)
    try MDAudioDownloadPolicy.validateRangeIdentity(
      identityRange, response: sameETag, previousTotal: 200,
      previousStrongETag: nil, kind: .audio)
    try expectFailure("AUDIO_RANGE_INVALID") {
      try MDAudioDownloadPolicy.validateRangeIdentity(
        identityRange, response: sameETag, previousTotal: 201,
        previousStrongETag: "\"same\"", kind: .audio)
    }
    try expectFailure("AUDIO_RANGE_INVALID") {
      try MDAudioDownloadPolicy.validateRangeIdentity(
        identityRange, response: sameETag, previousTotal: 200,
        previousStrongETag: "\"changed\"", kind: .audio)
    }

    let fileManager = FileManager.default
    let jobID = UUID().uuidString
    let workspace = try MDAudioDownloadPolicy.workspace(for: jobID, fileManager: fileManager)
    let temporary = workspace.appendingPathComponent("partial")
    try Data("audio".utf8).write(to: temporary)
    try MDAudioDownloadPolicy.truncateUnverifiedBytes(at: temporary, verifiedOffset: 3)
    guard try Data(contentsOf: temporary) == Data("aud".utf8) else {
      throw TestFailure.failed("Incomplete range was not truncated before retry")
    }
    let final = workspace.appendingPathComponent(
      MDAudioDownloadPolicy.safeFileName("../Own: audio.m4a")
    )
    try fileManager.moveItem(at: temporary, to: final)
    guard final.lastPathComponent == "_Own_ audio.m4a", fileManager.fileExists(atPath: final.path) else {
      throw TestFailure.failed("Atomic completion failed")
    }
    MDAudioDownloadPolicy.removeWorkspace(workspace, fileManager: fileManager)
    guard !fileManager.fileExists(atPath: workspace.path) else {
      throw TestFailure.failed("Cancellation/error cleanup failed")
    }
    print("AudioDownloadPolicyTests: passed")
  }
}
