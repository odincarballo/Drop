import Foundation

private enum TestFailure: Error { case failed(String) }

private func expectFailure(_ code: String, _ operation: () throws -> Void) throws {
  do {
    try operation()
    throw TestFailure.failed("Expected \(code)")
  } catch let failure as MDAVMuxFailure {
    guard failure.code == code else {
      throw TestFailure.failed("Expected \(code), received \(failure.code)")
    }
  }
}

@main
enum AVMuxPolicyTests {
  static func main() throws {
    guard try MDAVMuxPolicy.validatedDuration(121) == 121 else {
      throw TestFailure.failed("Expected duration was rejected")
    }
    try expectFailure("MUX_DURATION_INVALID") {
      _ = try MDAVMuxPolicy.validatedDuration(.infinity)
    }
    try expectFailure("MUX_VIDEO_TRACK_MISSING") {
      try MDAVMuxPolicy.validateTracks(
        videoCount: 0,
        audioCount: 1,
        videoCodecIsH264: true,
        audioCodecIsAAC: true
      )
    }
    try expectFailure("MUX_AUDIO_TRACK_MISSING") {
      try MDAVMuxPolicy.validateTracks(
        videoCount: 1,
        audioCount: 0,
        videoCodecIsH264: true,
        audioCodecIsAAC: true
      )
    }
    try expectFailure("MUX_VIDEO_CODEC_UNSUPPORTED") {
      try MDAVMuxPolicy.validateTracks(
        videoCount: 1,
        audioCount: 1,
        videoCodecIsH264: false,
        audioCodecIsAAC: true
      )
    }
    try expectFailure("MUX_AUDIO_CODEC_UNSUPPORTED") {
      try MDAVMuxPolicy.validateTracks(
        videoCount: 1,
        audioCount: 1,
        videoCodecIsH264: true,
        audioCodecIsAAC: false
      )
    }
    try MDAVMuxPolicy.validateAvailableDuration(
      120.95,
      expectedSeconds: 121,
      missingCode: "MUX_AUDIO_DURATION_INVALID"
    )
    try expectFailure("MUX_VIDEO_DURATION_INVALID") {
      try MDAVMuxPolicy.validateAvailableDuration(
        110,
        expectedSeconds: 121,
        missingCode: "MUX_VIDEO_DURATION_INVALID"
      )
    }
    try MDAVMuxPolicy.validateFinalDuration(120.95, expectedSeconds: 121)
    try expectFailure("MUX_OUTPUT_DURATION_INVALID") {
      try MDAVMuxPolicy.validateFinalDuration(118, expectedSeconds: 121)
    }
    print("AVMuxPolicyTests: passed")
  }
}
