import AVFoundation
import AudioToolbox
import Foundation

struct MDAVMuxResult {
  let fileSize: Int64
  let durationSeconds: Double
}

final class MDAVMuxer {
  typealias ProgressHandler = (Double) -> Void
  typealias CompletionHandler = (Result<MDAVMuxResult, MDAVMuxFailure>) -> Void

  private let queue = DispatchQueue(label: "MediaDrop.AVFoundationMux")
  private var exportSession: AVAssetExportSession?
  private var progressTimer: DispatchSourceTimer?
  private var cancelled = false

  func start(
    videoURL: URL,
    audioURL: URL,
    outputURL: URL,
    expectedDurationSeconds: Double,
    progress: @escaping ProgressHandler,
    completion: @escaping CompletionHandler
  ) {
    queue.async { [weak self] in
      guard let self else { return }
      do {
        let expected = try MDAVMuxPolicy.validatedDuration(expectedDurationSeconds)
        guard !cancelled else { throw MDAVMuxFailure.code("LOCAL_CANCELLED") }

        let videoAsset = AVURLAsset(url: videoURL)
        let audioAsset = AVURLAsset(url: audioURL)
        let videoTracks = videoAsset.tracks(withMediaType: .video)
        let audioTracks = audioAsset.tracks(withMediaType: .audio)
        let videoTrack = videoTracks.first
        let audioTrack = audioTracks.first
        try MDAVMuxPolicy.validateTracks(
          videoCount: videoTracks.count,
          audioCount: audioTracks.count,
          videoCodecIsH264: videoTrack.map { self.codecSubtype($0) == kCMVideoCodecType_H264 } ?? false,
          audioCodecIsAAC: audioTrack.map { self.isAAC(self.codecSubtype($0)) } ?? false
        )
        guard let videoTrack, let audioTrack else {
          throw MDAVMuxFailure.code("MUX_INPUT_INVALID")
        }
        try MDAVMuxPolicy.validateAvailableDuration(
          CMTimeGetSeconds(videoTrack.timeRange.duration),
          expectedSeconds: expected,
          missingCode: "MUX_VIDEO_DURATION_INVALID"
        )
        try MDAVMuxPolicy.validateAvailableDuration(
          CMTimeGetSeconds(audioTrack.timeRange.duration),
          expectedSeconds: expected,
          missingCode: "MUX_AUDIO_DURATION_INVALID"
        )

        let targetDuration = CMTime(seconds: expected, preferredTimescale: 600)
        let composition = AVMutableComposition()
        guard
          let compositionVideo = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
          ),
          let compositionAudio = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
          )
        else {
          throw MDAVMuxFailure.code("MUX_TRACK_CREATION_FAILED")
        }
        try compositionVideo.insertTimeRange(
          CMTimeRange(start: videoTrack.timeRange.start, duration: targetDuration),
          of: videoTrack,
          at: .zero
        )
        try compositionAudio.insertTimeRange(
          CMTimeRange(start: audioTrack.timeRange.start, duration: targetDuration),
          of: audioTrack,
          at: .zero
        )
        compositionVideo.preferredTransform = videoTrack.preferredTransform

        try? FileManager.default.removeItem(at: outputURL)
        guard
          let exporter = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPresetPassthrough
          ),
          exporter.supportedFileTypes.contains(.mp4)
        else {
          throw MDAVMuxFailure.code("MUX_PASSTHROUGH_UNAVAILABLE")
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .mp4
        exporter.timeRange = CMTimeRange(start: .zero, duration: targetDuration)
        exportSession = exporter
        startProgressTimer(exporter: exporter, progress: progress)
        exporter.exportAsynchronously { [weak self, weak exporter] in
          self?.queue.async { [weak self] in
            guard let self, let exporter else { return }
            self.stopProgressTimer()
            self.exportSession = nil
            if self.cancelled || exporter.status == .cancelled {
              completion(.failure(.code("LOCAL_CANCELLED")))
              return
            }
            guard exporter.status == .completed else {
              completion(.failure(.code("MUX_EXPORT_FAILED")))
              return
            }
            do {
              let result = try self.validateOutput(
                outputURL,
                expectedDurationSeconds: expected
              )
              progress(1)
              completion(.success(result))
            } catch let failure as MDAVMuxFailure {
              completion(.failure(failure))
            } catch {
              completion(.failure(.code("MUX_OUTPUT_INVALID")))
            }
          }
        }
      } catch let failure as MDAVMuxFailure {
        completion(.failure(failure))
      } catch {
        completion(.failure(.code("MUX_PREPARATION_FAILED")))
      }
    }
  }

  func cancel() {
    queue.async { [weak self] in
      self?.cancelled = true
      self?.exportSession?.cancelExport()
      self?.stopProgressTimer()
    }
  }

  private func startProgressTimer(
    exporter: AVAssetExportSession,
    progress: @escaping ProgressHandler
  ) {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(100))
    timer.setEventHandler { progress(Double(exporter.progress)) }
    progressTimer = timer
    timer.resume()
  }

  private func stopProgressTimer() {
    progressTimer?.setEventHandler {}
    progressTimer?.cancel()
    progressTimer = nil
  }

  private func validateOutput(
    _ url: URL,
    expectedDurationSeconds: Double
  ) throws -> MDAVMuxResult {
    let asset = AVURLAsset(url: url)
    let videoTracks = asset.tracks(withMediaType: .video)
    let audioTracks = asset.tracks(withMediaType: .audio)
    try MDAVMuxPolicy.validateTracks(
      videoCount: videoTracks.count,
      audioCount: audioTracks.count,
      videoCodecIsH264: videoTracks.first.map { codecSubtype($0) == kCMVideoCodecType_H264 } ?? false,
      audioCodecIsAAC: audioTracks.first.map { isAAC(codecSubtype($0)) } ?? false
    )
    let duration = CMTimeGetSeconds(asset.duration)
    try MDAVMuxPolicy.validateFinalDuration(
      duration,
      expectedSeconds: expectedDurationSeconds
    )
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
    guard size > 0 else { throw MDAVMuxFailure.code("MUX_OUTPUT_INVALID") }
    return MDAVMuxResult(fileSize: size, durationSeconds: duration)
  }

  private func codecSubtype(_ track: AVAssetTrack) -> FourCharCode? {
    guard let rawDescription = track.formatDescriptions.first else { return nil }
    let description = rawDescription as! CMFormatDescription
    return CMFormatDescriptionGetMediaSubType(description)
  }

  private func isAAC(_ subtype: FourCharCode?) -> Bool {
    guard let subtype else { return false }
    return subtype == kAudioFormatMPEG4AAC
      || subtype == kAudioFormatMPEG4AAC_HE
      || subtype == kAudioFormatMPEG4AAC_HE_V2
  }
}
