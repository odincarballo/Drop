import Foundation

enum MDAVMuxFailure: Error {
  case code(String)

  var code: String {
    switch self {
    case .code(let value): return value
    }
  }
}

enum MDAVMuxPolicy {
  static let maximumDurationSeconds = 6 * 60 * 60.0
  static let durationToleranceSeconds = 1.0

  static func validatedDuration(_ seconds: Double) throws -> Double {
    guard seconds.isFinite, seconds > 0, seconds <= maximumDurationSeconds else {
      throw MDAVMuxFailure.code("MUX_DURATION_INVALID")
    }
    return seconds
  }

  static func validateTracks(
    videoCount: Int,
    audioCount: Int,
    videoCodecIsH264: Bool,
    audioCodecIsAAC: Bool
  ) throws {
    guard videoCount > 0 else { throw MDAVMuxFailure.code("MUX_VIDEO_TRACK_MISSING") }
    guard audioCount > 0 else { throw MDAVMuxFailure.code("MUX_AUDIO_TRACK_MISSING") }
    guard videoCodecIsH264 else { throw MDAVMuxFailure.code("MUX_VIDEO_CODEC_UNSUPPORTED") }
    guard audioCodecIsAAC else { throw MDAVMuxFailure.code("MUX_AUDIO_CODEC_UNSUPPORTED") }
  }

  static func validateAvailableDuration(
    _ availableSeconds: Double,
    expectedSeconds: Double,
    missingCode: String
  ) throws {
    guard
      availableSeconds.isFinite,
      availableSeconds + durationToleranceSeconds >= expectedSeconds
    else {
      throw MDAVMuxFailure.code(missingCode)
    }
  }

  static func validateFinalDuration(_ seconds: Double, expectedSeconds: Double) throws {
    guard seconds.isFinite, abs(seconds - expectedSeconds) <= durationToleranceSeconds else {
      throw MDAVMuxFailure.code("MUX_OUTPUT_DURATION_INVALID")
    }
  }
}
