import Foundation

private enum TestFailure: Error { case failed(String) }

@main
enum HTTPTransferDiagnosticsTests {
  static func main() throws {
    let signedURL = URL(string:
      "https://rr1.googlevideo.com/videoplayback?sig=SECRET&token=PRIVATE")!
    let response = HTTPURLResponse(
      url: signedURL,
      statusCode: 403,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Range": "bytes */2000000",
        "Content-Length": "42",
        "Authorization": "Bearer PRIVATE",
        "Set-Cookie": "session=SECRET",
      ]
    )!
    var diagnostics = MDHTTPTransferDiagnostics()
    diagnostics.captureRequest(start: 0, end: 262_143)
    diagnostics.captureResponse(response)
    diagnostics.captureAudioHTTPFailure(
      response,
      rangeStart: 262_144,
      rangeEnd: 524_287,
      rangeIndex: 2,
      bytesPersisted: 262_144
    )
    let value = diagnostics.eventValue()
    guard value["requestedRange"] as? String == "bytes=0-262143",
          value["failureRequestedRange"] as? String == "bytes=262144-524287",
          value["failureStatusCode"] as? Int == 403,
          value["failureRangeIndex"] as? Int == 2,
          value["failureBytesPersisted"] as? Int64 == 262_144,
          value["failureHost"] as? String == "rr1.googlevideo.com",
          value["failureContentRange"] as? String == "bytes */2000000",
          value["failureContentLength"] as? String == "42" else {
      throw TestFailure.failed("Expected structured HTTP failure facts")
    }
    let rendered = String(describing: value)
    for forbidden in ["SECRET", "PRIVATE", "?", "Authorization", "Cookie", "https://"] {
      guard !rendered.contains(forbidden) else {
        throw TestFailure.failed("Sensitive value crossed the bridge: \(forbidden)")
      }
    }

    let hostile = HTTPURLResponse(
      url: URL(string: "https://other.example/path?token=SECRET")!,
      statusCode: 503,
      httpVersion: nil,
      headerFields: [
        "Content-Range": "bytes 0-99/100?sig=SECRET",
        "Content-Length": "42; token=PRIVATE",
      ]
    )!
    var rejected = MDHTTPTransferDiagnostics()
    rejected.captureAudioHTTPFailure(
      hostile, rangeStart: 0, rangeEnd: 99, rangeIndex: 1, bytesPersisted: 0
    )
    let rejectedValue = rejected.eventValue()
    guard rejectedValue["failureHost"] == nil,
          rejectedValue["failureContentRange"] == nil,
          rejectedValue["failureContentLength"] == nil else {
      throw TestFailure.failed("Untrusted header or host was exposed")
    }
    print("HTTPTransferDiagnosticsTests: passed")
  }
}
