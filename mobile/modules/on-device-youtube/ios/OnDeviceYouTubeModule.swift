import ExpoModulesCore

public class OnDeviceYouTubeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnDeviceYouTube")

    AsyncFunction("analyze") { (url: String, promise: Promise) in
      MDPythonBridge.analyze(url) { result in promise.resolve(result) }
    }

    AsyncFunction("testEjsFixture") { (promise: Promise) in
      MDPythonBridge.testEJS { result in promise.resolve(result) }
    }

    Function("cancel") { MDPythonBridge.cancel() }
    OnAppEntersBackground { MDPythonBridge.cancel() }
  }
}
