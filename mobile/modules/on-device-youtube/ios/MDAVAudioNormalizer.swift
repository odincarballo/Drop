import AVFoundation
import AudioToolbox
import Foundation

struct MDAVAudioNormalizationResult {
  let fileSize: Int64
  let durationSeconds: Double
}

final class MDAVAudioNormalizer {
  typealias CompletionHandler = Result<MDAVAudioNormalizationResult, MDAudioNormalizationFailure>

  private let queue = DispatchQueue(label: "Drop.AVFoundationAudioNormalization")
  private var exportSession: AVAssetExportSession?
  private var cancelled = false

  func start(
    inputURL: URL,
    outputURL: URL,
    expectedDurationSeconds: Double,
    completion: @escaping (CompletionHandler) -> Void
  ) {
    queue.async { [weak self] in
      guard let self else { return }
      do {
        let expected = try MDAudioNormalizationPolicy.validatedDuration(expectedDurationSeconds)
        guard !cancelled else {
          throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_CANCELLED")
        }
        let asset = AVURLAsset(url: inputURL)
        let tracks = asset.tracks(withMediaType: .audio)
        guard tracks.count == 1, let track = tracks.first else {
          throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_INPUT_INVALID")
        }
        guard isAAC(track) else {
          throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_CODEC_UNSUPPORTED")
        }
        try MDAudioNormalizationPolicy.validateInputDuration(
          CMTimeGetSeconds(track.timeRange.duration), expected: expected
        )

        let target = CMTime(seconds: expected, preferredTimescale: 600)
        let composition = AVMutableComposition()
        guard let audio = composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
          throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_INPUT_INVALID")
        }
        try audio.insertTimeRange(
          CMTimeRange(start: track.timeRange.start, duration: target),
          of: track,
          at: .zero
        )
        guard let exporter = AVAssetExportSession(
          asset: composition, presetName: AVAssetExportPresetPassthrough
        ), exporter.supportedFileTypes.contains(.m4a) else {
          throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_EXPORT_UNAVAILABLE")
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .m4a
        exporter.timeRange = CMTimeRange(start: .zero, duration: target)
        exportSession = exporter
        exporter.exportAsynchronously { [weak self, weak exporter] in
          self?.queue.async { [weak self] in
            guard let self, let exporter else { return }
            self.exportSession = nil
            if self.cancelled || exporter.status == .cancelled {
              completion(.failure(.code("AUDIO_NORMALIZATION_CANCELLED")))
              return
            }
            guard exporter.status == .completed else {
              completion(.failure(.code("AUDIO_NORMALIZATION_EXPORT_FAILED")))
              return
            }
            do {
              completion(.success(try self.validateOutput(outputURL, expected: expected)))
            } catch let failure as MDAudioNormalizationFailure {
              completion(.failure(failure))
            } catch {
              completion(.failure(.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")))
            }
          }
        }
      } catch let failure as MDAudioNormalizationFailure {
        completion(.failure(failure))
      } catch {
        completion(.failure(.code("AUDIO_NORMALIZATION_INPUT_INVALID")))
      }
    }
  }

  func cancel() {
    queue.async { [weak self] in
      self?.cancelled = true
      self?.exportSession?.cancelExport()
    }
  }

  private func validateOutput(
    _ url: URL, expected: Double
  ) throws -> MDAVAudioNormalizationResult {
    let asset = AVURLAsset(url: url)
    let tracks = asset.tracks(withMediaType: .audio)
    guard asset.isPlayable, tracks.count == 1, let track = tracks.first,
          isAAC(track) else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
    let duration = CMTimeGetSeconds(asset.duration)
    try MDAudioNormalizationPolicy.validateOutputDuration(duration, expected: expected)
    try MDAudioNormalizationPolicy.validateOutputDuration(
      CMTimeGetSeconds(track.timeRange.duration), expected: expected
    )
    try MDAudioNormalizationPolicy.validateLastSampleEnd(
      try lastSampleEnd(asset: asset, track: track), expected: expected
    )
    let size = ((try FileManager.default.attributesOfItem(atPath: url.path))[.size] as? NSNumber)?
      .int64Value ?? -1
    guard size > 0 else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
    return MDAVAudioNormalizationResult(fileSize: size, durationSeconds: duration)
  }

  private func lastSampleEnd(asset: AVURLAsset, track: AVAssetTrack) throws -> Double {
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    guard reader.canAdd(output) else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
    var lastEnd: Double?
    while let buffer = output.copyNextSampleBuffer() {
      guard CMSampleBufferGetNumSamples(buffer) > 0 else { continue }
      let start = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer))
      let duration = CMTimeGetSeconds(CMSampleBufferGetDuration(buffer))
      guard start.isFinite, duration.isFinite, duration > 0 else {
        throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
      }
      lastEnd = max(lastEnd ?? 0, start + duration)
    }
    guard reader.status == .completed, let lastEnd else {
      throw MDAudioNormalizationFailure.code("AUDIO_NORMALIZATION_OUTPUT_INVALID")
    }
    return lastEnd
  }

  private func isAAC(_ track: AVAssetTrack) -> Bool {
    guard let raw = track.formatDescriptions.first else { return false }
    let subtype = CMFormatDescriptionGetMediaSubType(raw as! CMFormatDescription)
    return subtype == kAudioFormatMPEG4AAC
      || subtype == kAudioFormatMPEG4AAC_HE
      || subtype == kAudioFormatMPEG4AAC_HE_V2
  }
}
