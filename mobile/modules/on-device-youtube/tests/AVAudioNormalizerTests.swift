import AVFoundation
import AudioToolbox
import Foundation

private enum TestFailure: Error { case failed(String) }

@main
enum AVAudioNormalizerTests {
  static func main() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "DropAudioNormalizerTests-\(UUID().uuidString)", isDirectory: true
    )
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { _ = MDAudioDownloadPolicy.removeWorkspace(directory) }

    let input = directory.appendingPathComponent("spanish-track.m4a")
    try writeAACFixture(to: input)
    let resultURL = directory.appendingPathComponent("normalized.m4a")
    let result = awaitResult(input: input, output: resultURL, duration: 1)
    guard case .success(let normalized) = result else {
      throw TestFailure.failed("Passthrough M4A export failed: \(result)")
    }
    guard normalized.fileSize > 0, abs(normalized.durationSeconds - 1) < 0.1 else {
      throw TestFailure.failed("Wrong normalized duration or empty output")
    }
    let outputAsset = AVURLAsset(url: resultURL)
    guard outputAsset.tracks(withMediaType: .audio).count == 1,
          abs(CMTimeGetSeconds(outputAsset.duration) - 1) < 0.1 else {
      throw TestFailure.failed("Output does not contain one playable audio track")
    }
    let outputTrack = outputAsset.tracks(withMediaType: .audio)[0]
    let raw = outputTrack.formatDescriptions.first! as! CMFormatDescription
    guard CMFormatDescriptionGetMediaSubType(raw) == kAudioFormatMPEG4AAC else {
      throw TestFailure.failed("Passthrough changed the AAC codec")
    }

    let unavailable = awaitResult(
      input: input,
      output: directory.appendingPathComponent("missing/failed.m4a"),
      duration: 1
    )
    guard case .failure(let exportFailure) = unavailable,
          exportFailure.code == "AUDIO_NORMALIZATION_EXPORT_FAILED" else {
      throw TestFailure.failed("Export failure was not reported")
    }
    guard !FileManager.default.fileExists(
      atPath: directory.appendingPathComponent("missing/failed.m4a").path
    ) else {
      throw TestFailure.failed("Failed export left a publishable output")
    }

    let cancelledURL = directory.appendingPathComponent("cancelled.m4a")
    let cancelled = awaitResult(input: input, output: cancelledURL, duration: 1, cancel: true)
    guard case .failure(let cancellation) = cancelled,
          cancellation.code == "AUDIO_NORMALIZATION_CANCELLED" else {
      throw TestFailure.failed("Cancellation did not reach a terminal state")
    }
    // The owner must clean only after the cancellation callback; this mirrors its job cleanup.
    try FileManager.default.removeItem(at: input)
    if FileManager.default.fileExists(atPath: cancelledURL.path) {
      try FileManager.default.removeItem(at: cancelledURL)
    }
    guard !FileManager.default.fileExists(atPath: input.path),
          !FileManager.default.fileExists(atPath: cancelledURL.path) else {
      throw TestFailure.failed("Cancelled inputs or output were not cleaned")
    }
    if CommandLine.arguments.count >= 2 {
      let anomalousInput = URL(fileURLWithPath: CommandLine.arguments[1])
      let expectedDuration = CommandLine.arguments.count >= 3
        ? Double(CommandLine.arguments[2])! : 917
      let anomalousOutput = directory.appendingPathComponent("long-normalized.m4a")
      let longResult = awaitResult(
        input: anomalousInput, output: anomalousOutput, duration: expectedDuration
      )
      guard case .success(let normalized) = longResult,
            abs(normalized.durationSeconds - expectedDuration) < 0.1 else {
        throw TestFailure.failed("Source audio was not normalized: \(longResult)")
      }
      let longAsset = AVURLAsset(url: anomalousOutput)
      guard longAsset.isPlayable,
            longAsset.tracks(withMediaType: .audio).count == 1 else {
        throw TestFailure.failed("Normalized source audio is not playable")
      }
      let longTrack = longAsset.tracks(withMediaType: .audio)[0]
      let longFormat = longTrack.formatDescriptions.first! as! CMFormatDescription
      guard CMFormatDescriptionGetMediaSubType(longFormat) == kAudioFormatMPEG4AAC else {
        throw TestFailure.failed("Normalized source audio lost AAC")
      }
      print("Source audio: \(normalized.durationSeconds) s, \(normalized.fileSize) bytes, AAC")
    }
    print("AVAudioNormalizerTests: passed")
  }

  private static func writeAACFixture(to url: URL) throws {
    let settings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: 44_100,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 64_000,
    ]
    let file = try AVAudioFile(
      forWriting: url, settings: settings,
      commonFormat: .pcmFormatFloat32, interleaved: false
    )
    let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100)!
    buffer.frameLength = 44_100
    for index in 0..<44_100 {
      buffer.floatChannelData![0][index] = 0.05 * sin(Float(index) * 0.04)
    }
    try file.write(from: buffer)
  }

  private static func awaitResult(
    input: URL, output: URL, duration: Double, cancel: Bool = false
  ) -> Result<MDAVAudioNormalizationResult, MDAudioNormalizationFailure> {
    let finished = DispatchSemaphore(value: 0)
    let normalizer = MDAVAudioNormalizer()
    var result: Result<MDAVAudioNormalizationResult, MDAudioNormalizationFailure>?
    normalizer.start(
      inputURL: input, outputURL: output, expectedDurationSeconds: duration
    ) {
      result = $0
      finished.signal()
    }
    if cancel { normalizer.cancel() }
    guard finished.wait(timeout: .now() + 20) == .success, let result else {
      return .failure(.code("TEST_TIMEOUT"))
    }
    return result
  }
}
