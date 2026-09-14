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
    _ = try MDAudioDownloadPolicy.validateHeaders([
      "User-Agent": "MediaDrop", "Accept-Language": "es",
    ])
    try expectFailure("AUDIO_HEADERS_FORBIDDEN") {
      _ = try MDAudioDownloadPolicy.validateHeaders(["Cookie": "secret"])
    }
    try expectFailure("AUDIO_HEADERS_INVALID") {
      _ = try MDAudioDownloadPolicy.validateHeaders(["X-Unknown": "value"])
    }
    try expectFailure("AUDIO_FILE_TOO_LARGE") {
      try MDAudioDownloadPolicy.validateExpectedLength(
        MDAudioDownloadPolicy.maximumBytes + 1
      )
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
