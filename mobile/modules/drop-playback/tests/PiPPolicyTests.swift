import Foundation

@main
struct PiPPolicyTests {
  static func main() {
    for missing in ["supported", "possible", "ready"] {
      let available = DropPiPPolicy.canStartInline(presentation: "inline",
        supported: missing != "supported", possible: missing != "possible",
        ready: missing != "ready")
      precondition(!available)
    }
    precondition(DropPiPPolicy.canStartInline(presentation: "inline",
      supported: true, possible: true, ready: true))
    for presentation in ["fullscreen", "pipStarting", "pip", "pipStopping",
                         "restoringUI", "backgroundAudio", "closed"] {
      precondition(!DropPiPPolicy.canStartInline(presentation: presentation,
        supported: true, possible: true, ready: true))
    }
    for presentation in ["pipStarting", "pip", "pipStopping", "restoringUI"] {
      precondition(DropPiPPolicy.isActiveOrTransitioning(presentation))
      precondition(DropPiPPolicy.shouldParkSource(presentation: presentation,
        sameSource: true, fullscreenOwner: false))
      precondition(!DropPiPPolicy.shouldParkSource(presentation: presentation,
        sameSource: false, fullscreenOwner: false))
      precondition(!DropPiPPolicy.shouldParkSource(presentation: presentation,
        sameSource: true, fullscreenOwner: true))
    }
    // Route navigation cannot retire the native PiP source; regular inline
    // navigation can release it, and fullscreen AVKit owns its own source.
    for presentation in ["inline", "fullscreen", "backgroundAudio", "closed"] {
      precondition(!DropPiPPolicy.shouldParkSource(presentation: presentation,
        sameSource: true, fullscreenOwner: false))
    }
    var visualPresentation = "inline"
    var fullscreenTransfers = 0
    if DropPiPPolicy.canTransferToFullscreen(presentation: visualPresentation) {
      visualPresentation = "fullscreen"
      fullscreenTransfers += 1
    }
    precondition(fullscreenTransfers == 1)
    precondition(!DropPiPPolicy.canTransferToFullscreen(presentation: visualPresentation))
    precondition(!DropPiPPolicy.canTransferToFullscreen(presentation: "pip"))
    precondition(!DropPiPPolicy.canStartInline(presentation: visualPresentation,
      supported: true, possible: true, ready: true))
    // Dismiss may be reported by two delegates; inline is never rebound while
    // AVPlayerViewController still holds the player, and transfer is idempotent.
    precondition(!DropPiPPolicy.canReconnectInline(fullscreenHasPlayer: true))
    precondition(DropPiPPolicy.canReconnectInline(fullscreenHasPlayer: false))
    let dismiss = DropFullscreenDismissGate()
    // UIKit reports completion even when an interactive swipe is cancelled.
    precondition(!dismiss.transitionCompleted(cancelled: true,
      stillPresented: true, fullscreenPiPActive: false))
    precondition(!dismiss.transferred) // Fullscreen retains its player/layer.
    precondition(!dismiss.transitionCompleted(cancelled: false,
      stillPresented: true, fullscreenPiPActive: false))
    precondition(!dismiss.transitionCompleted(cancelled: false,
      stillPresented: false, fullscreenPiPActive: true)) // AVKit PiP owns it.
    precondition(dismiss.transitionCompleted(cancelled: false,
      stillPresented: false, fullscreenPiPActive: false)) // X or completed swipe.
    precondition(!dismiss.didDismiss(fullscreenPiPActive: false)) // Duplicate UIKit callback.
    dismiss.reset() // The next fullscreen controller has its own transition.
    precondition(dismiss.didDismiss(fullscreenPiPActive: false))
    precondition(!dismiss.transitionCompleted(cancelled: false,
      stillPresented: false, fullscreenPiPActive: false))
    visualPresentation = "inline"
    precondition(DropPiPPolicy.canStartInline(presentation: visualPresentation,
      supported: true, possible: true, ready: true))
    for presentation in ["inline", "fullscreen", "backgroundAudio", "closed"] {
      precondition(!DropPiPPolicy.isActiveOrTransitioning(presentation))
    }
    precondition(!DropPiPPolicy.closeAfterStop(reason: "restore"))
    for reason in ["systemStop", "delete", "itemEnded", "replacement", "failure"] {
      precondition(DropPiPPolicy.closeAfterStop(reason: reason))
    }
    // Captured playing and selectedRate belong to the service's original
    // AVPlayerItem; restoration only authorizes that exact unchanged intent.
    func mayResume(generation: Bool = true, id: Bool = true, item: Bool = true,
                   intent: Bool = true, state: Bool = true, restored: Bool = true) -> Bool {
      DropPiPPolicy.shouldResumeAfterRestore(sameGeneration: generation,
        sameID: id, sameItem: item, unchangedIntent: intent,
        safeState: state, restored: restored)
    }
    precondition(mayResume()) // PiP playing -> successful restore.
    precondition(!mayResume(intent: false)) // User pause, route loss or interruption.
    precondition(!mayResume(state: false)) // Interrupted, ended or failed.
    precondition(!mayResume(generation: false)) // Stale callback or close.
    precondition(!mayResume(id: false)) // Different library record.
    precondition(!mayResume(item: false)) // Replaced AVPlayerItem.
    precondition(!mayResume(restored: false)) // Failed restoration.
    func preservesFullscreenPlayback(generation: Bool = true, id: Bool = true,
      item: Bool = true, intent: Bool = true, playing: Bool = true,
      state: Bool = true, settled: Bool = true) -> Bool {
      DropPiPPolicy.shouldResumeAfterFullscreenDismiss(
        sameGeneration: generation, sameID: id, sameItem: item,
        unchangedIntent: intent, wasPlaying: playing, safeState: state,
        transitionSettled: settled)
    }
    precondition(preservesFullscreenPlayback()) // Playing -> confirmed dismiss -> playing.
    precondition(!preservesFullscreenPlayback(playing: false)) // Paused remains paused.
    precondition(!preservesFullscreenPlayback(intent: false)) // Manual pause/rate, route, interruption.
    precondition(!preservesFullscreenPlayback(state: false)) // Interrupted/ended/failed.
    precondition(!preservesFullscreenPlayback(generation: false)) // Close/delete/replacement.
    precondition(!preservesFullscreenPlayback(id: false))
    precondition(!preservesFullscreenPlayback(item: false))
    precondition(!preservesFullscreenPlayback(settled: false)) // PiP or unfinished transition.
    print("PiPPolicyTests: passed")
  }
}
