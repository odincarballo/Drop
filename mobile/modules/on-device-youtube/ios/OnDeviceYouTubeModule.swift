import ExpoModulesCore

public class OnDeviceYouTubeModule: Module {
  private lazy var audioDownload = MDAudioDownloadManager { [weak self] event in
    let mediaType = event["mediaType"] as? String
    self?.sendEvent(
      mediaType == "video" ? "onVideoDownloadState" : "onAudioDownloadState",
      event
    )
  }

  public func definition() -> ModuleDefinition {
    Name("OnDeviceYouTube")
    Events("onAudioDownloadState", "onVideoDownloadState")

    AsyncFunction("analyze") { (url: String, promise: Promise) in
      MDPythonBridge.analyze(url) { result in promise.resolve(result) }
    }

    AsyncFunction("testEjsFixture") { (promise: Promise) in
      MDPythonBridge.testEJS { result in promise.resolve(result) }
    }

    Function("startAudioDownload") { (analysisId: String, formatId: String) -> String? in
      audioDownload.start(analysisID: analysisId, formatID: formatId)
    }

    Function("cancelAudioDownload") { audioDownload.cancel() }

    Function("startVideoDownload") { (analysisId: String, formatId: String) -> String? in
      audioDownload.startVideo(analysisID: analysisId, formatID: formatId)
    }

    Function("cancelVideoDownload") { audioDownload.cancel() }

    Function("cancel") { MDPythonBridge.cancel() }
    OnAppEntersBackground {
      MDPythonBridge.cancel()
      audioDownload.cancel()
    }
  }
}
