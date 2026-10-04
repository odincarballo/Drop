import AVFoundation
import ExpoModulesCore
import UIKit

// Rendering only: the view neither owns a player nor creates an AVPlayerItem.
final class DropPlaybackVideoView: ExpoView {
  override class var layerClass: AnyClass { AVPlayerLayer.self }

  private var videoLayer: AVPlayerLayer { layer as! AVPlayerLayer }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    videoLayer.videoGravity = .resizeAspect
    backgroundColor = .black
  }

  override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if newSuperview == nil {
      DropPlaybackService.shared.detachVideoLayer(videoLayer)
    } else {
      DropPlaybackService.shared.attachVideoLayer(videoLayer)
    }
  }
}
