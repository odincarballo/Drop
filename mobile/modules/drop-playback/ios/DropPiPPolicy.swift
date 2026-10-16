import Foundation

// Pure decision boundary shared by the AVKit coordinator and deterministic
// Swift tests. Presentation never changes AVPlayer/AVPlayerItem ownership.
enum DropPiPPolicy {
  static let active: Set<String> = [
    "pipStarting", "pip", "pipStopping", "restoringUI"
  ]

  // This controls retention of the inline PiP source, not the playback session.
  // Route navigation retains the service's AVPlayerItem in every presentation.
  static func isActiveOrTransitioning(_ presentation: String) -> Bool {
    active.contains(presentation)
  }

  // AVKit needs the source view in a UIWindow, not merely a retained layer.
  // A React route detach must park only the current inline source during PiP.
  static func shouldParkSource(presentation: String, sameSource: Bool,
                               fullscreenOwner: Bool) -> Bool {
    sameSource && !fullscreenOwner && isActiveOrTransitioning(presentation)
  }

  static func canStartInline(presentation: String, supported: Bool,
                             possible: Bool, ready: Bool) -> Bool {
    presentation == "inline" && supported && possible && ready
  }

  static func canTransferToFullscreen(presentation: String) -> Bool {
    presentation == "inline"
  }

  static func canReconnectInline(fullscreenHasPlayer: Bool) -> Bool {
    !fullscreenHasPlayer
  }

  // A transition can finish because an interactive dismissal was cancelled.
  // Only a completed, confirmed dismissal may transfer the visual output.
  static func canFinishFullscreenDismiss(cancelled: Bool, stillPresented: Bool,
                                         fullscreenPiPActive: Bool) -> Bool {
    !cancelled && !stillPresented && !fullscreenPiPActive
  }

  static func closeAfterStop(reason: String) -> Bool {
    reason != "restore"
  }

  static func shouldResumeAfterRestore(sameGeneration: Bool, sameID: Bool,
                                       sameItem: Bool, unchangedIntent: Bool,
                                       safeState: Bool, restored: Bool) -> Bool {
    sameGeneration && sameID && sameItem && unchangedIntent && safeState && restored
  }

  static func shouldResumeAfterFullscreenDismiss(sameGeneration: Bool, sameID: Bool,
                                                 sameItem: Bool, unchangedIntent: Bool,
                                                 wasPlaying: Bool, safeState: Bool,
                                                 transitionSettled: Bool) -> Bool {
    sameGeneration && sameID && sameItem && unchangedIntent && wasPlaying &&
      safeState && transitionSettled
  }
}

// Both AVKit and UIKit can report the same completed dismissal. Keep the
// transfer exactly once, without letting a cancelled gesture consume it.
final class DropFullscreenDismissGate {
  private(set) var transferred = false

  func transitionCompleted(cancelled: Bool, stillPresented: Bool,
                           fullscreenPiPActive: Bool) -> Bool {
    guard !transferred,
          DropPiPPolicy.canFinishFullscreenDismiss(cancelled: cancelled,
            stillPresented: stillPresented, fullscreenPiPActive: fullscreenPiPActive)
    else { return false }
    transferred = true
    return true
  }

  func didDismiss(fullscreenPiPActive: Bool) -> Bool {
    transitionCompleted(cancelled: false, stillPresented: false,
      fullscreenPiPActive: fullscreenPiPActive)
  }

  func reset() { transferred = false }
}
