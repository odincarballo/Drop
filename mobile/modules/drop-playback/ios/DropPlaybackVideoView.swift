import AVFoundation
import ExpoModulesCore
import UIKit

// The child is the PiP source. Unlike an ExpoView backing layer, it can move
// to the coordinator's native host when React removes the player screen.
final class DropPlaybackVideoSurfaceView: UIView {
  override class var layerClass: AnyClass { AVPlayerLayer.self }
}

// Rendering only: neither view owns a player or creates an AVPlayerItem.
final class DropPlaybackVideoView: ExpoView {
  private let videoSurface = DropPlaybackVideoSurfaceView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    (videoSurface.layer as? AVPlayerLayer)?.videoGravity = .resizeAspect
    videoSurface.frame = bounds
    videoSurface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(videoSurface)
    backgroundColor = .black
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if videoSurface.superview === self { videoSurface.frame = bounds }
  }

  override func willMove(toSuperview newSuperview: UIView?) {
    if newSuperview == nil {
      // Transfer before UIKit removes the React view from the hierarchy.
      DropPlaybackService.shared.detachVideoSurface(videoSurface)
    } else {
      DropPlaybackService.shared.attachVideoSurface(videoSurface)
    }
    super.willMove(toSuperview: newSuperview)
  }
}
