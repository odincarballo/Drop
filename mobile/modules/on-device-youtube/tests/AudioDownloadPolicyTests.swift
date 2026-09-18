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
      MDAudioDownloadPolicy.resourceTimeoutSeconds == 300
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
    try expectFailure("VIDEO_RANGE_NOT_SUPPORTED") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        videoResponse,
        requestedStart: 0,
        requestedEnd: 262143
      )
    }
    try expectFailure("VIDEO_RANGE_INVALID") {
      _ = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        rangedVideoResponse,
        requestedStart: 262144,
        requestedEnd: 524287
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

    let fileManager = FileManager.default
    let jobID = UUID().uuidString
    let workspace = try MDAudioDownloadPolicy.workspace(for: jobID, fileManager: fileManager)
    let temporary = workspace.appendingPathComponent("partial")
    try Data("audio".utf8).write(to: temporary)
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
