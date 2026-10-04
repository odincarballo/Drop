import AVKit
import ExpoModulesCore
import UIKit

@MainActor
enum DropPlaybackOrientation {
  static var fullscreen = false

  static var allowedMask: UIInterfaceOrientationMask {
    fullscreen ? .landscape : .portrait
  }
}

// The plist includes landscape so UIKit can rotate, but ordinary Drop screens
// remain portrait. Expo registers this subscriber on every clean prebuild.
public final class DropPlaybackOrientationSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
                          supportedInterfaceOrientationsFor window: UIWindow?)
    -> UIInterfaceOrientationMask {
    DropPlaybackOrientation.allowedMask
  }
}

final class DropPlaybackFullscreenController: AVPlayerViewController {
  var didDisappear: (() -> Void)?

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil { didDisappear?() }
  }
}
