import AVFoundation
import AVKit
import UIKit

@MainActor
enum DropPiPStopReason: String {
  case systemStop, restore, delete, itemEnded, replacement, failure
}

// One logical owner. AVKit's inline and fullscreen controllers are never
// eligible at the same time; both use the service's existing AVPlayer.
@MainActor
final class DropPlaybackPiPCoordinator: NSObject, AVPictureInPictureControllerDelegate,
  AVPlayerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  enum Presentation: String {
    case inline, fullscreen, pipStarting, pip, pipStopping, restoringUI,
         backgroundAudio, closed
  }

  private(set) var presentation: Presentation = .closed
  private(set) var sourceLayer: AVPlayerLayer?
  private var sourceSurface: UIView?
  private var sourceHost: UIView?
  private weak var visibleLayer: AVPlayerLayer?
  private weak var player: AVPlayer?
  private var inlineController: AVPictureInPictureController?
  private weak var fullscreenController: AVPlayerViewController?
  private var owner: String = "inline"
  private var possibleObservation: NSKeyValueObservation?
  private var readyObservation: NSKeyValueObservation?
  private var stopReason: DropPiPStopReason = .systemStop
  private var restoreCompletion: ((Bool) -> Void)?
  private var restoreSucceeded = false
  private var pendingStop: CheckedContinuation<Bool, Never>?
  private let fullscreenDismissGate = DropFullscreenDismissGate()
  private var token: UInt64 = 0
  private var stopSerial: UInt64 = 0
  var onChange: (() -> Void)?
  var onSystemStop: ((UInt64, DropPiPStopReason) -> Void)?
  var onRestore: ((UInt64) -> Void)?
  var onRestoreStopped: ((UInt64) -> Void)?
  var onFullscreenDismissWillBegin: (() -> Void)?
  var onFullscreenDismissCancelled: (() -> Void)?
  var onFullscreenDismiss: (() -> Void)?

  var isActiveOrTransitioning: Bool {
    DropPiPPolicy.isActiveOrTransitioning(presentation.rawValue)
  }
  var canStartInline: Bool {
    DropPiPPolicy.canStartInline(presentation: presentation.rawValue,
      supported: isSupported,
      possible: inlineController?.isPictureInPicturePossible == true,
      ready: sourceLayer?.isReadyForDisplay == true)
  }
  var isSupported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }
  var ownsFullscreenPiP: Bool { owner == "fullscreen" && isActiveOrTransitioning }

  func configure(token: UInt64, mediaType: String, player: AVPlayer) {
    // A queued video may become current while AVKit owns PiP. Rebinding the
    // same player must not turn an active PiP presentation back into inline.
    if mediaType == "video", isActiveOrTransitioning {
      self.token = token
      self.player = player
      onChange?()
      return
    }
    self.token = token
    self.player = player
    presentation = mediaType == "video" ? .inline : .closed
    stopReason = .systemStop
    if mediaType != "video" { discardInline() }
    if mediaType == "video", let visibleSurface { attach(visibleSurface, player: player) }
    onChange?()
  }

  private weak var visibleSurface: UIView?

  func attach(_ surface: UIView, player: AVPlayer) {
    guard let layer = surface.layer as? AVPlayerLayer else { return }
    self.player = player
    visibleSurface = surface
    visibleLayer = layer
    guard presentation == .inline,
          DropPiPPolicy.canReconnectInline(
            fullscreenHasPlayer: fullscreenController?.player != nil) else { return }
    if sourceLayer !== layer {
      discardInline()
      sourceSurface = surface
      sourceLayer = layer
      layer.player = player
      if isSupported,
         let controller = AVPictureInPictureController(playerLayer: layer) {
        controller.delegate = self
        inlineController = controller
        possibleObservation = controller.observe(\.isPictureInPicturePossible,
          options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor [weak self] in self?.onChange?() }
        }
        readyObservation = layer.observe(\.isReadyForDisplay,
          options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor [weak self] in self?.onChange?() }
        }
      }
    }
    onChange?()
  }

  func detach(_ surface: UIView) {
    guard let layer = surface.layer as? AVPlayerLayer else { return }
    if visibleSurface === surface { visibleSurface = nil }
    if visibleLayer === layer { visibleLayer = nil }
    guard sourceLayer === layer else { return }
    if DropPiPPolicy.shouldParkSource(presentation: presentation.rawValue,
      sameSource: true, fullscreenOwner: owner == "fullscreen") {
      parkSourceSurface()
      return
    }
    discardInline()
  }

  private func parkSourceSurface() {
    guard let surface = sourceSurface, sourceHost == nil,
          let window = surface.window else { return }
    // Keep the AVPlayerLayer's UIView in a real UIWindow after its ExpoView
    // disappears. The host sits behind the app root; it is not a React screen
    // or another player. It lives only until PiP stops/replaces the item.
    let frame = surface.convert(surface.bounds, to: window)
    let host = UIView(frame: frame)
    host.isUserInteractionEnabled = false
    host.accessibilityElementsHidden = true
    host.backgroundColor = .clear
    window.insertSubview(host, at: 0)
    host.addSubview(surface)
    surface.frame = host.bounds
    sourceHost = host
  }

  func updateAutomaticStart(playing: Bool, inlineVisible: Bool) {
    inlineController?.canStartPictureInPictureAutomaticallyFromInline =
      playing && inlineVisible && presentation == .inline
    fullscreenController?.canStartPictureInPictureAutomaticallyFromInline =
      playing && presentation == .fullscreen
  }

  func startInline() throws {
    guard canStartInline, let inlineController else { throw DropPlaybackError.pipUnavailable }
    presentation = .pipStarting
    stopReason = .systemStop
    inlineController.startPictureInPicture()
    onChange?()
  }

  func enterFullscreen(_ controller: AVPlayerViewController) throws {
    guard DropPiPPolicy.canTransferToFullscreen(presentation: presentation.rawValue),
          !isActiveOrTransitioning else {
      throw DropPlaybackError.pipUnavailable
    }
    // Disconnect the inline visual output and its PiP controller before the
    // service assigns the same AVPlayer to AVPlayerViewController.
    discardInline()
    fullscreenDismissGate.reset()
    fullscreenController = controller
    owner = "fullscreen"
    controller.delegate = self
    controller.presentationController?.delegate = self
    controller.allowsPictureInPicturePlayback = isSupported
    controller.canStartPictureInPictureAutomaticallyFromInline = false
    presentation = .fullscreen
    onChange?()
  }

  func leaveFullscreen() {
    guard fullscreenController != nil else { return }
    guard !ownsFullscreenPiP else { return }
    // The service must detach AVPlayerViewController.player first. Reconnecting
    // inline here while fullscreen still renders creates two visual outputs.
    guard DropPiPPolicy.canReconnectInline(
      fullscreenHasPlayer: fullscreenController?.player != nil) else { return }
    fullscreenController?.delegate = nil
    fullscreenController?.presentationController?.delegate = nil
    fullscreenController = nil
    owner = "inline"
    if presentation == .fullscreen { presentation = .inline }
    if presentation == .inline, let visibleSurface, let player {
      attach(visibleSurface, player: player)
    }
    onChange?()
  }

  func stop(reason: DropPiPStopReason) async throws {
    guard isActiveOrTransitioning else { return }
    guard pendingStop == nil else { throw DropPlaybackError.pipUnavailable }
    let wasStarting = presentation == .pipStarting
    stopReason = reason
    stopSerial &+= 1
    let serial = stopSerial
    presentation = .pipStopping
    onChange?()
    if owner == "inline", inlineController?.isPictureInPictureActive == true {
      let stopped = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        pendingStop = continuation
        scheduleStopTimeout(serial: serial)
        inlineController?.stopPictureInPicture()
      }
      guard stopped else { throw DropPlaybackError.pipUnavailable }
    } else if owner == "fullscreen", let fullscreenController,
              !wasStarting {
      let stopped = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        pendingStop = continuation
        scheduleStopTimeout(serial: serial)
        // AVPlayerViewController has no public stopPiP method. Removing its
        // presentation player requests termination; the service's AVPlayerItem
        // and lease remain held until didStop confirms it.
        fullscreenController.player = nil
        fullscreenController.allowsPictureInPicturePlayback = false
      }
      guard stopped else { throw DropPlaybackError.pipUnavailable }
    } else if wasStarting {
      let stopped = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        pendingStop = continuation
        scheduleStopTimeout(serial: serial)
      }
      guard stopped else { throw DropPlaybackError.pipUnavailable }
    } else {
      finishStop()
    }
    guard serial == stopSerial else { return }
  }

  private func scheduleStopTimeout(serial: UInt64) {
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard let self, self.stopSerial == serial, let pending = self.pendingStop else { return }
      self.pendingStop = nil
      pending.resume(returning: false)
      self.onChange?()
    }
  }

  func reset() {
    restoreCompletion?(false)
    restoreCompletion = nil
    restoreSucceeded = false
    pendingStop?.resume(returning: false)
    pendingStop = nil
    discardInline()
    fullscreenController?.delegate = nil
    fullscreenController = nil
    fullscreenDismissGate.reset()
    presentation = .closed
    onChange?()
  }

  func completeRestore(_ restored: Bool) {
    guard presentation == .restoringUI, let completion = restoreCompletion else { return }
    restoreCompletion = nil
    restoreSucceeded = restored
    completion(restored)
    if !restored { stopReason = .failure }
  }

  private func discardInline() {
    possibleObservation = nil
    readyObservation = nil
    inlineController?.delegate = nil
    inlineController = nil
    sourceLayer?.player = nil
    sourceLayer = nil
    if let sourceSurface, sourceSurface.superview === sourceHost {
      sourceSurface.removeFromSuperview()
    }
    sourceSurface = nil
    sourceHost?.removeFromSuperview()
    sourceHost = nil
  }

  private func finishStop() {
    guard isActiveOrTransitioning else { return }
    let reason = stopReason
    let previousToken = token
    let didRestore = reason == .restore && restoreSucceeded
    restoreSucceeded = false
    pendingStop?.resume(returning: true)
    pendingStop = nil
    restoreCompletion?(false)
    restoreCompletion = nil
    if !DropPiPPolicy.closeAfterStop(reason: reason.rawValue) {
      presentation = .inline
      if owner == "fullscreen" { onFullscreenDismiss?() }
    } else {
      presentation = .backgroundAudio
      onSystemStop?(previousToken, reason)
    }
    if let visibleSurface, let player,
       presentation == .inline, sourceSurface !== visibleSurface {
      attach(visibleSurface, player: player)
    } else if visibleLayer == nil && !isActiveOrTransitioning {
      discardInline()
    }
    onChange?()
    if didRestore { onRestoreStopped?(previousToken) }
  }

  private func didStart(owner: String) {
    guard presentation == .pipStarting || presentation == .fullscreen ||
          presentation == .pipStopping else { return }
    self.owner = owner
    if presentation == .pipStopping {
      if owner == "inline" { inlineController?.stopPictureInPicture() }
      else {
        fullscreenController?.player = nil
        fullscreenController?.allowsPictureInPicturePlayback = false
      }
      return
    }
    presentation = .pip
    onChange?()
  }

  private func didFail() {
    guard isActiveOrTransitioning else { return }
    if presentation == .pipStarting {
      presentation = owner == "fullscreen" ? .fullscreen : .inline
      if visibleSurface == nil { discardInline() }
      onChange?()
      return // A failed start must not stop ordinary video/background audio.
    }
    stopReason = .failure
    finishStop()
  }

  private func requestRestore(_ completion: @escaping (Bool) -> Void) {
    guard presentation == .pip, restoreCompletion == nil else {
      completion(false); return
    }
    presentation = .restoringUI
    stopReason = .restore
    restoreSucceeded = false
    restoreCompletion = completion
    let requestToken = token
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard let self, self.token == requestToken,
            self.presentation == .restoringUI else { return }
      self.completeRestore(false)
    }
    if let onRestore { onRestore(token) }
    else { completeRestore(false) }
    onChange?()
  }

  nonisolated func pictureInPictureControllerDidStartPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController) {
    Task { @MainActor in
      guard self.inlineController === pictureInPictureController else { return }
      self.didStart(owner: "inline")
    }
  }
  nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    failedToStartPictureInPictureWithError error: Error) {
    Task { @MainActor in
      guard self.inlineController === pictureInPictureController else { return }
      self.didFail()
    }
  }
  nonisolated func pictureInPictureControllerDidStopPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController) {
    Task { @MainActor in
      guard self.inlineController === pictureInPictureController else { return }
      self.finishStop()
    }
  }
  nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
    Task { @MainActor in
      guard self.inlineController === pictureInPictureController else {
        completionHandler(false); return
      }
      self.requestRestore(completionHandler)
    }
  }

  nonisolated func playerViewControllerDidStartPictureInPicture(
    _ playerViewController: AVPlayerViewController) {
    Task { @MainActor in
      guard self.fullscreenController === playerViewController else { return }
      self.didStart(owner: "fullscreen")
    }
  }
  nonisolated func playerViewControllerWillStartPictureInPicture(
    _ playerViewController: AVPlayerViewController) {
    Task { @MainActor in
      guard self.fullscreenController === playerViewController,
            self.presentation == .fullscreen else { return }
      // AVKit may dismiss fullscreen before didStart arrives. That dismissal
      // belongs to PiP, not to the inline visual handoff.
      self.presentation = .pipStarting
      self.onChange?()
    }
  }
  nonisolated func playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(
    _ playerViewController: AVPlayerViewController) -> Bool {
    true
  }
  nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
    failedToStartPictureInPictureWithError error: Error) {
    Task { @MainActor in
      guard self.fullscreenController === playerViewController else { return }
      self.didFail()
    }
  }
  nonisolated func playerViewControllerDidStopPictureInPicture(
    _ playerViewController: AVPlayerViewController) {
    Task { @MainActor in
      guard self.fullscreenController === playerViewController else { return }
      self.finishStop()
    }
  }
  nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
    Task { @MainActor in
      guard self.fullscreenController === playerViewController else {
        completionHandler(false); return
      }
      self.requestRestore(completionHandler)
    }
  }
  nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
    willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
    // UIKit delivers presentation callbacks on main. Capture effective
    // playback before AVKit can temporarily set rate to zero for the handoff.
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        self.observeFullscreenDismiss(playerViewController, coordinator: coordinator)
      }
    } else {
      Task { @MainActor in
        self.observeFullscreenDismiss(playerViewController, coordinator: coordinator)
      }
    }
  }
  private func observeFullscreenDismiss(_ controller: AVPlayerViewController,
    coordinator: UIViewControllerTransitionCoordinator) {
    guard fullscreenController === controller else { return }
    if !ownsFullscreenPiP { onFullscreenDismissWillBegin?() }
    coordinator.animate(alongsideTransition: nil) { context in
      let cancelled = context.isCancelled
      Task { @MainActor in
        guard self.fullscreenController === controller else { return }
        if cancelled {
          self.onFullscreenDismissCancelled?()
        } else if self.fullscreenDismissGate.transitionCompleted(cancelled: false,
            stillPresented: controller.presentingViewController != nil,
            fullscreenPiPActive: self.ownsFullscreenPiP) {
          self.onFullscreenDismiss?()
        }
      }
    }
  }
  nonisolated func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        guard self.fullscreenController === presentationController.presentedViewController,
              !self.ownsFullscreenPiP else { return }
        self.onFullscreenDismissWillBegin?()
      }
    } else {
      Task { @MainActor in
        guard self.fullscreenController === presentationController.presentedViewController,
              !self.ownsFullscreenPiP else { return }
        self.onFullscreenDismissWillBegin?()
      }
    }
  }
  nonisolated func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    Task { @MainActor in
      guard self.fullscreenController === presentationController.presentedViewController else { return }
      if self.fullscreenDismissGate.didDismiss(fullscreenPiPActive: self.ownsFullscreenPiP) {
        self.onFullscreenDismiss?()
      }
    }
  }
}
