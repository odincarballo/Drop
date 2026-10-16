import ExpoModulesCore
import Foundation

private final class PlaybackOperationException: Exception, @unchecked Sendable {
  private let detail: String
  init(_ detail: String) { self.detail = detail; super.init() }
  override var reason: String { detail }
}

public final class DropPlaybackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DropPlayback")
    Events("onPlaybackState", "onPiPRestore")

    View(DropPlaybackVideoView.self) {}

    OnCreate {
      Task { @MainActor [weak self] in
        DropPlaybackService.shared.onState = { [weak self] state in
          self?.sendEvent("onPlaybackState", state)
        }
        DropPlaybackService.shared.onRestore = { [weak self] id in
          self?.sendEvent("onPiPRestore", ["libraryId": id])
        }
      }
    }

    OnDestroy {
      Task { @MainActor in
        DropPlaybackService.shared.onState = nil
        DropPlaybackService.shared.onRestore = nil
      }
    }

    AsyncFunction("open") { (id: String, promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.open(id: id) }
    }
    AsyncFunction("startInContext") { (id: String, orderedIds: [String], promise: Promise) in
      self.run(promise) {
        try await DropPlaybackService.shared.startInContext(id: id, orderedIds: orderedIds)
      }
    }
    AsyncFunction("play") { (promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.play() }
    }
    AsyncFunction("pause") { (promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.pause() }
    }
    AsyncFunction("seek") { (seconds: Double, promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.seek(seconds) }
    }
    AsyncFunction("skip") { (seconds: Double, promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.skip(seconds) }
    }
    AsyncFunction("setRate") { (rate: Double, promise: Promise) in
      self.run(promise) { try DropPlaybackService.shared.setRate(rate) }
    }
    AsyncFunction("close") { (promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.close() }
    }
    AsyncFunction("getState") { (promise: Promise) in
      self.run(promise) { DropPlaybackService.shared.snapshot() }
    }
    AsyncFunction("enterFullscreen") { (promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.enterFullscreen() }
    }
    AsyncFunction("exitFullscreen") { (promise: Promise) in
      self.run(promise) { await DropPlaybackService.shared.exitFullscreen() }
    }
    AsyncFunction("startPiP") { (promise: Promise) in
      self.run(promise) { try DropPlaybackService.shared.startPiP() }
    }
    AsyncFunction("completePiPRestore") { (restored: Bool, promise: Promise) in
      self.run(promise) { DropPlaybackService.shared.completePiPRestore(restored) }
    }
    AsyncFunction("leavePlayerScreen") { (id: String, promise: Promise) in
      self.run(promise) { try await DropPlaybackService.shared.leavePlayerScreen(id) }
    }
    AsyncFunction("beginDelete") { (id: String, promise: Promise) in
      self.run(promise) {
        try await DropPlaybackService.shared.beginDelete(id)
        return ["ready": true]
      }
    }
    AsyncFunction("endDelete") { (id: String, promise: Promise) in
      self.run(promise) {
        DropPlaybackService.shared.endDelete(id)
        return ["ready": true]
      }
    }
  }

  private func run(_ promise: Promise,
                   _ operation: @escaping @MainActor () async throws -> [String: Any]) {
    Task { @MainActor in
      do { promise.resolve(try await operation()) }
      catch {
        let safe = error as? DropPlaybackError
        promise.reject(PlaybackOperationException(safe?.message ??
          "No se pudo completar la operación del reproductor."))
      }
    }
  }
}
