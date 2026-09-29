import Foundation

private enum TestFailure: Error { case failed(String) }

private func expectFailure(_ code: String, _ operation: () throws -> Void) throws {
  do {
    try operation()
    throw TestFailure.failed("Expected \(code)")
  } catch let failure as MDAudioNormalizationFailure {
    guard failure.code == code else {
      throw TestFailure.failed("Expected \(code), received \(failure.code)")
    }
  }
}

@main
enum AudioNormalizationPolicyTests {
  static func main() throws {
    guard try MDAudioNormalizationPolicy.validatedDuration(917) == 917 else {
      throw TestFailure.failed("Analysis duration was rejected")
    }
    try expectFailure("AUDIO_DURATION_INVALID") {
      _ = try MDAudioNormalizationPolicy.validatedDuration(.infinity)
    }
    try expectFailure("AUDIO_DURATION_INVALID") {
      _ = try MDAudioNormalizationPolicy.validatedDuration(0)
    }
    // A DASH track may declare twice the duration while real AAC packets end near 917 s.
    try MDAudioNormalizationPolicy.validateInputDuration(1834.607, expected: 917)
    try MDAudioNormalizationPolicy.validateLastSampleEnd(917.28, expected: 917)
    try MDAudioNormalizationPolicy.validateOutputDuration(917, expected: 917)
    try expectFailure("AUDIO_NORMALIZATION_INPUT_INVALID") {
      try MDAudioNormalizationPolicy.validateInputDuration(900, expected: 917)
    }
    try expectFailure("AUDIO_NORMALIZATION_OUTPUT_INVALID") {
      try MDAudioNormalizationPolicy.validateOutputDuration(1834.607, expected: 917)
    }
    try expectFailure("AUDIO_NORMALIZATION_OUTPUT_INVALID") {
      try MDAudioNormalizationPolicy.validateLastSampleEnd(900, expected: 917)
    }
    print("AudioNormalizationPolicyTests: passed")
  }
}
