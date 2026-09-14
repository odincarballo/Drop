import ExpoModulesCore

public class OnDeviceYouTubeModule: Module {
  private lazy var audioDownload = MDAudioDownloadManager { [weak self] event in
    self?.sendEvent("onAudioDownloadState", event)
  }

  public func definition() -> ModuleDefinition {
    Name("OnDeviceYouTube")
    Events("onAudioDownloadState")

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

    Function("cancel") { MDPythonBridge.cancel() }
    OnAppEntersBackground {
      MDPythonBridge.cancel()
      audioDownload.cancel()
    }
  }
}
