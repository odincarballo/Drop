import ExpoModulesCore

public class OnDeviceYouTubeModule: Module {
  private lazy var audioDownload = MDAudioDownloadManager(emitEvent: { [weak self] event in
    let mediaType = event["mediaType"] as? String
    self?.sendEvent(
      mediaType == "video" ? "onVideoDownloadState" : "onAudioDownloadState",
      event
    )
  })
  private lazy var combinedDownload = MDCombinedDownloadManager(emitEvent: { [weak self] event in
    self?.sendEvent("onCombinedDownloadState", event)
  })

  public func definition() -> ModuleDefinition {
    Name("OnDeviceYouTube")
    Events("onAudioDownloadState", "onVideoDownloadState", "onCombinedDownloadState")

    AsyncFunction("analyze") { (url: String, promise: Promise) in
      MDPythonBridge.analyze(url) { result in promise.resolve(result) }
    }

    AsyncFunction("testEjsFixture") { (promise: Promise) in
      MDPythonBridge.testEJS { result in promise.resolve(result) }
    }

    Function("startAudioDownload") {
      (analysisId: String, formatId: String, durationSeconds: Double) -> String? in
      guard !combinedDownload.isActive else { return nil }
      return audioDownload.start(
        analysisID: analysisId, formatID: formatId, durationSeconds: durationSeconds
      )
    }

    Function("cancelAudioDownload") { audioDownload.cancel() }

    Function("startVideoDownload") { (analysisId: String, formatId: String) -> String? in
      guard !combinedDownload.isActive else { return nil }
      return audioDownload.startVideo(analysisID: analysisId, formatID: formatId)
    }

    Function("cancelVideoDownload") { audioDownload.cancel() }

    Function("startCombinedDownload") {
      (
        analysisId: String,
        videoFormatId: String,
        audioFormatId: String,
        durationSeconds: Double,
        audioExactBytes: Int64?,
        audioApproximateBytes: Int64?
      ) -> String? in
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

    Function("cancelCombinedDownload") { combinedDownload.cancel() }

    Function("cancel") { MDPythonBridge.cancel() }
    OnAppEntersBackground {
      MDPythonBridge.cancel()
      audioDownload.cancel()
      combinedDownload.cancel()
    }
  }
}
