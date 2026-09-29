import Foundation

enum MDAudioNormalizationFailure: Error {
  case code(String)

  var code: String {
    switch self {
    case .code(let value): return value
    }
  }
}

enum MDAudioNormalizationPolicy {
  static let maximumDurationSeconds = 6 * 60 * 60.0
  static let durationToleranceSeconds = 1.0

  static func validatedDuration(_ seconds: Double) throws -> Double {
    guard seconds.isFinite, seconds > 0, seconds <= maximumDurationSeconds else {
      throw MDAudioNormalizationFailure.code("AUDIO_DURATION_INVALID")
    }
    return seconds
  }

  static func validateInputDuration(_ seconds: Double, expected: Double) throws {
    guard seconds.isFinite, seconds + durationToleranceSeconds >= expected else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_INPUT_INVALID")
    }
  }

  static func validateOutputDuration(_ seconds: Double, expected: Double) throws {
    guard seconds.isFinite, abs(seconds - expected) <= durationToleranceSeconds else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
  }

  static func validateLastSampleEnd(_ seconds: Double, expected: Double) throws {
    guard seconds.isFinite, abs(seconds - expected) <= durationToleranceSeconds else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
  }
}
