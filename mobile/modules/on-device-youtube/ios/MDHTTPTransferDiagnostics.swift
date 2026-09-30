import Foundation

// Only structured, allowlisted transfer facts cross the native/React Native bridge.
// In particular, never forward a raw URL, query string, request header or response header.
struct MDHTTPTransferDiagnostics {
  private(set) var requestedRange: String?
  private(set) var statusCode: Int?
  private(set) var contentRange: String?
  private(set) var contentLength: String?
  private(set) var finalHost: String?
  private(set) var failureStatusCode: Int?
  private(set) var failureRequestedRange: String?
  private(set) var failureHost: String?
  private(set) var failureContentRange: String?
  private(set) var failureContentLength: String?
  private(set) var failureRangeIndex: Int?
  private(set) var failureBytesPersisted: Int64?
  private(set) var failurePhase: String?
  private(set) var failureCategory: String?
  private(set) var failureTransportCode: Int?
  private(set) var failureRangeAttempt: Int?
  private(set) var retriesUsed: Int?
  private(set) var recoverySecondsRemaining: Int?

  mutating func captureFailure(
    phase: String, category: String, transportCode: Error?, status: Int?,
    start: Int64, end: Int64, index: Int, offset: Int64, attempt: Int,
    globalRetries: Int, remainingSeconds: TimeInterval?, host: String?,
    contentRange: String?, contentLength: String?
  ) {
    failurePhase = ["audio", "video"].contains(phase) ? phase : nil
    failureCategory = ["connection", "timeout", "server", "forbidden", "range",
      "rate_limit", "integrity", "security", "dns", "cancelled", "other"].contains(category)
      ? category : nil
    let ns = transportCode as NSError?
    if let ns, ns.domain == NSURLErrorDomain,
       [NSURLErrorTimedOut, NSURLErrorCannotConnectToHost,
        NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
        NSURLErrorCannotFindHost, NSURLErrorSecureConnectionFailed,
        NSURLErrorServerCertificateUntrusted, NSURLErrorCancelled].contains(ns.code) {
      failureTransportCode = ns.code
    } else {
      failureTransportCode = nil
    }
    failureStatusCode = status.flatMap(Self.safeStatus)
    failureRequestedRange = Self.safeRange(start: start, end: end)
    failureRangeIndex = index > 0 ? index : nil
    failureBytesPersisted = offset >= 0 ? offset : nil
    failureRangeAttempt = (1...3).contains(attempt) ? attempt : nil
    retriesUsed = (0...4).contains(globalRetries) ? globalRetries : nil
    recoverySecondsRemaining = remainingSeconds.map { max(0, min(30, Int($0.rounded(.down)))) }
    failureHost = Self.safeHost(host)
    failureContentRange = Self.safeContentRange(contentRange)
    failureContentLength = Self.safeContentLength(contentLength)
  }

  mutating func captureRequest(start: Int64, end: Int64) {
    guard requestedRange == nil else { return }
    requestedRange = Self.safeRange(start: start, end: end)
  }

  mutating func captureResponse(_ response: HTTPURLResponse) {
    guard statusCode == nil else { return }
    statusCode = Self.safeStatus(response.statusCode)
    contentRange = Self.safeContentRange(response.value(forHTTPHeaderField: "Content-Range"))
    contentLength = Self.safeContentLength(response.value(forHTTPHeaderField: "Content-Length"))
    finalHost = Self.safeHost(response.url?.host)
  }

  mutating func captureAudioHTTPFailure(
    _ response: HTTPURLResponse,
    rangeStart: Int64,
    rangeEnd: Int64,
    rangeIndex: Int,
    bytesPersisted: Int64
  ) {
    failureStatusCode = Self.safeStatus(response.statusCode)
    failureRequestedRange = Self.safeRange(start: rangeStart, end: rangeEnd)
    failureHost = Self.safeHost(response.url?.host)
    failureContentRange = Self.safeContentRange(
      response.value(forHTTPHeaderField: "Content-Range")
    )
    failureContentLength = Self.safeContentLength(
      response.value(forHTTPHeaderField: "Content-Length")
    )
    failureRangeIndex = rangeIndex > 0 ? rangeIndex : nil
    failureBytesPersisted = bytesPersisted >= 0 ? bytesPersisted : nil
  }

  func eventValue() -> [String: Any] {
    var value: [String: Any] = [:]
    value["requestedRange"] = requestedRange
    value["statusCode"] = statusCode
    value["contentRange"] = contentRange
    value["contentLength"] = contentLength
    value["finalHost"] = finalHost
    value["failureStatusCode"] = failureStatusCode
    value["failureRequestedRange"] = failureRequestedRange
    value["failureHost"] = failureHost
    value["failureContentRange"] = failureContentRange
    value["failureContentLength"] = failureContentLength
    value["failureRangeIndex"] = failureRangeIndex
    value["failureBytesPersisted"] = failureBytesPersisted
    value["failurePhase"] = failurePhase
    value["failureCategory"] = failureCategory
    value["failureTransportCode"] = failureTransportCode
    value["failureRangeAttempt"] = failureRangeAttempt
    value["retriesUsed"] = retriesUsed
    value["recoverySecondsRemaining"] = recoverySecondsRemaining
    return value
  }

  private static func safeStatus(_ status: Int) -> Int? {
    (100...599).contains(status) ? status : nil
  }

  private static func safeRange(start: Int64, end: Int64) -> String? {
    guard start >= 0, end >= start else { return nil }
    return "bytes=\(start)-\(end)"
  }

  private static func safeHost(_ raw: String?) -> String? {
    guard let host = raw?.lowercased(), host.count <= 253,
          host == "googlevideo.com" || host.hasSuffix(".googlevideo.com"),
          !host.contains(".."), !host.hasPrefix("."),
          host.utf8.allSatisfy({ byte in
            (97...122).contains(byte) || (48...57).contains(byte) || byte == 45 || byte == 46
          }) else { return nil }
    return host
  }

  private static func safeContentLength(_ raw: String?) -> String? {
    guard let raw, let length = Int64(raw), length >= 0 else { return nil }
    return String(length)
  }

  private static func safeContentRange(_ raw: String?) -> String? {
    guard let raw, raw.hasPrefix("bytes ") else { return nil }
    let parts = raw.dropFirst(6).split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, let total = Int64(parts[1]), total > 0 else { return nil }
    if parts[0] == "*" { return "bytes */\(total)" }
    let bounds = parts[0].split(separator: "-", omittingEmptySubsequences: false)
    guard bounds.count == 2, let start = Int64(bounds[0]), let end = Int64(bounds[1]),
          start >= 0, end >= start, end < total else { return nil }
    return "bytes \(start)-\(end)/\(total)"
  }
}
