import ExpoModulesCore
import UIKit

public class OnDeviceYouTubeModule: Module {
  @MainActor private var foregroundGeneration = 0
  @MainActor private lazy var audioDownload = MDAudioDownloadManager(emitEvent: { [weak self] event in
    let mediaType = event["mediaType"] as? String
    self?.sendEvent(
      mediaType == "video" ? "onVideoDownloadState" : "onAudioDownloadState",
      event
    )
  })
  @MainActor private lazy var combinedDownload = MDCombinedDownloadManager(emitEvent: { [weak self] event in
    self?.sendEvent("onCombinedDownloadState", event)
  })

  private func onMain<T: Sendable>(_ body: @MainActor () -> T) -> T {
    if Thread.isMainThread { return MainActor.assumeIsolated(body) }
    return DispatchQueue.main.sync { MainActor.assumeIsolated(body) }
  }

  private func startInForeground(_ generation: Int, _ start: @MainActor () -> String?) -> String? {
    // UIKit lifecycle notifications and manager starts are ordered on main.
    onMain {
      guard UIApplication.shared.applicationState == .active,
        generation == foregroundGeneration else { return "APP_NOT_ACTIVE" }
      return start()
    }
  }

  public func definition() -> ModuleDefinition {
    Name("OnDeviceYouTube")
    Events("onAudioDownloadState", "onVideoDownloadState", "onCombinedDownloadState")

    AsyncFunction("analyze") { (url: String, promise: Promise) in
      MDPythonBridge.analyze(url) { result in promise.resolve(result) }
    }

    Function("downloadForegroundGeneration") { () -> Int? in
      onMain {
        UIApplication.shared.applicationState == .active ? foregroundGeneration : nil
      }
    }

    Function("startAudioDownload") {
      (analysisId: String, formatId: String, durationSeconds: Double, generation: Int) -> String? in
      startInForeground(generation) {
        guard !combinedDownload.isActive else { return nil }
        return audioDownload.start(
          analysisID: analysisId, formatID: formatId, durationSeconds: durationSeconds
        )
      }
    }

    Function("cancelAudioDownload") { onMain { audioDownload.cancel() } }

    Function("startVideoDownload") { (analysisId: String, formatId: String, generation: Int) -> String? in
      startInForeground(generation) {
        guard !combinedDownload.isActive else { return nil }
        return audioDownload.startVideo(analysisID: analysisId, formatID: formatId)
      }
    }

    Function("cancelVideoDownload") { onMain { audioDownload.cancel() } }

    Function("startCombinedDownload") {
      (
        analysisId: String,
        videoFormatId: String,
        audioFormatId: String,
        durationSeconds: Double,
        audioExactBytes: Int64?,
        audioApproximateBytes: Int64?,
        generation: Int
      ) -> String? in
      startInForeground(generation) {
        guard !audioDownload.isActive else { return nil }
        return combinedDownload.start(
          analysisID: analysisId,
          videoFormatID: videoFormatId,
          audioFormatID: audioFormatId,
          expectedDurationSeconds: durationSeconds,
          audioExactBytes: audioExactBytes,
          audioApproximateBytes: audioApproximateBytes
        )
      }
    }

    Function("cancelCombinedDownload") { onMain { combinedDownload.cancel() } }

    Function("cancel") { MDPythonBridge.cancel() }
    OnAppEntersBackground {
      onMain {
        foregroundGeneration += 1
        MDPythonBridge.cancel()
        audioDownload.cancel()
        combinedDownload.cancel()
      }
    }
  }
}
