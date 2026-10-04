import AVFoundation
import AVKit
import AudioToolbox
#if canImport(UIKit)
import UIKit
#endif
#if canImport(DropLibrary)
import DropLibrary
#endif
import Foundation

enum DropPlaybackError: Error {
  case invalidID
  case unavailable
  case unsupported
  case invalidMedia
  case notReady
  case invalidPosition
  case invalidRate
  case audioSession
  case superseded

  var code: String {
    switch self {
    case .invalidID: return "INVALID_ID"
    case .unavailable: return "UNAVAILABLE"
    case .unsupported: return "UNSUPPORTED_FORMAT"
    case .invalidMedia: return "INVALID_MEDIA"
    case .notReady: return "NOT_READY"
    case .invalidPosition: return "INVALID_POSITION"
    case .invalidRate: return "INVALID_RATE"
    case .audioSession: return "AUDIO_SESSION_FAILED"
    case .superseded: return "SUPERSEDED"
    }
  }

  var message: String {
    switch self {
    case .invalidID: return "El elemento de Biblioteca no es válido."
    case .unavailable: return "El archivo ya no está disponible en Biblioteca."
    case .unsupported: return "Este formato aún no se puede reproducir en Drop."
    case .invalidMedia: return "El archivo no se puede reproducir."
    case .notReady: return "El reproductor todavía no está listo."
    case .invalidPosition: return "La posición de reproducción no es válida."
    case .invalidRate: return "Esta velocidad no está disponible."
    case .audioSession: return "No se pudo activar el audio del dispositivo."
    case .superseded: return "La operación fue sustituida por otra."
    }
  }
}

@MainActor
final class DropPlaybackService {
  static let shared = DropPlaybackService()

  // Exactly one AVPlayer exists for the app's native playback service.
  let player: AVPlayer
  var onState: (([String: Any]) -> Void)?

  private var repository: PlaybackProgressRepository?
  private var storage: DropLibraryStorage?
  private let system: PlaybackSystemBridge
  private var generation: UInt64 = 0
  private let leases = PlaybackLeaseCoordinator()
  private var activeID: String?
  private var activeMediaType: String?
  #if canImport(UIKit)
  private var fullscreenController: DropPlaybackFullscreenController?
  #endif
  private var state = "idle"
  private var position: Double = 0
  private var duration: Double?
  private var rate: Double = 1
  private var wasPlayingBeforeInterruption = false
  private var lastNowPlayingUpdate = Date.distantPast
  private var completedAt: String?
  private var dirty = false
  private var lastSave = Date()
  private var errorCode: String?
  private var statusObservation: NSKeyValueObservation?
  private var endObservation: NSObjectProtocol?
  private var failureObservation: NSObjectProtocol?
  private var timeObserver: Any?
  #if canImport(UIKit)
  private var rateObservation: NSKeyValueObservation?
  private var timeJumpObservation: NSObjectProtocol?
  #endif
  private var pendingSave: Task<Void, Never>?

  init(player: AVPlayer = AVPlayer(), storage: DropLibraryStorage? = nil,
       repository: PlaybackProgressRepository? = nil,
       system: PlaybackSystemBridge? = nil) {
    self.player = player
    self.storage = storage
    self.repository = repository
    self.system = system ?? IOSPlaybackSystemBridge()
    #if os(iOS)
    player.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
    #endif
    #if canImport(UIKit)
    rateObservation = player.observe(\.rate, options: [.new]) { [weak self] player, _ in
      Task { @MainActor [weak self] in
        guard let self, self.fullscreenController != nil,
              self.player.currentItem != nil else { return }
        let selected = Double(player.defaultRate)
        if PlaybackPolicy.rates.contains(selected) { self.rate = selected }
        if player.rate > 0 {
          do { try self.system.activate() }
          catch { await self.failCurrent(.audioSession, token: self.generation); return }
          self.position = self.safeCurrentPosition()
          if let duration = self.duration, self.completedAt != nil,
             !PlaybackPolicy.completed(position: self.position, duration: duration) {
            self.completedAt = nil
            self.dirty = true
          }
          if self.state != "playing" { self.state = "playing"; self.emit() }
          self.updateNowPlaying()
        } else if self.state == "playing" {
          self.state = "paused"
          self.position = self.safeCurrentPosition()
          self.dirty = true
          self.emit()
          self.updateNowPlaying()
          do { try await self.persist() }
          catch { self.errorCode = "PROGRESS_SAVE_FAILED"; self.emit() }
        }
      }
    }
    #endif
  }

  func snapshot() -> [String: Any] {
    ["libraryId": activeID as Any? ?? NSNull(), "status": state,
     "position": position, "duration": duration as Any? ?? NSNull(),
     "rate": rate, "playable": ["ready", "paused", "playing", "ended"].contains(state),
     "fullscreen": fullscreenActive,
     "completed": completedAt != nil,
     "errorCode": errorCode as Any? ?? NSNull()]
  }

  private func emit() { onState?(snapshot()) }

  private var fullscreenActive: Bool {
    #if canImport(UIKit)
    fullscreenController != nil
    #else
    false
    #endif
  }

  func isRetaining(_ id: String) -> Bool { leases.currentID == id }

  private func resources() throws -> (DropLibraryStorage, PlaybackProgressRepository) {
    if storage == nil {
      storage = try DropLibraryStorage()
    }
    if repository == nil {
      repository = SQLitePlaybackProgressRepository(
        databaseURL: storage!.root.appendingPathComponent("library.sqlite"))
    }
    return (storage!, repository!)
  }

  func open(id: String) async throws -> [String: Any] {
    guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else {
      throw DropPlaybackError.invalidID
    }
    guard !leases.isDeleting(id) else { throw DropPlaybackError.unavailable }
    generation &+= 1
    let token = generation
    try await retireCurrent()
    guard token == generation, !leases.isDeleting(id) else {
      throw DropPlaybackError.superseded
    }
    // Reserve before any asynchronous database or asset work. Delete first blocks
    // new opens, then closes this reserved lease before removing the file.
    guard leases.reserve(id) else { throw DropPlaybackError.unavailable }
    activeID = id
    activeMediaType = nil
    state = "loading"
    errorCode = nil
    position = 0
    duration = nil
    completedAt = nil
    wasPlayingBeforeInterruption = false
    emit()
    do {
      let (storage, repository) = try resources()
      let record = try await repository.load(id: id)
      try current(token, id: id)
      let relative = record.relativeMediaPath
      let ext = URL(fileURLWithPath: relative).pathExtension.lowercased()
      guard PlaybackPolicy.supported(extension: ext, mediaType: record.mediaType) else {
        throw DropPlaybackError.unsupported
      }
      guard URL(fileURLWithPath: relative).deletingPathExtension().lastPathComponent == id,
            let (url, size) = try storage.managedMedia(relative: relative),
            size == record.sizeBytes, size > 0 else { throw DropPlaybackError.unavailable }
      let asset = AVURLAsset(url: url)
      let seconds = CMTimeGetSeconds(try await asset.load(.duration))
      let playable = try await asset.load(.isPlayable)
      let tracks = try await asset.loadTracks(withMediaType:
        record.mediaType == "video" ? .video : .audio)
      try current(token, id: id)
      guard playable, !tracks.isEmpty, PlaybackPolicy.validDuration(seconds) else {
        throw DropPlaybackError.invalidMedia
      }
      if record.mediaType == "audio" {
        let descriptions = try await tracks[0].load(.formatDescriptions)
        guard descriptions.contains(where: {
          CMFormatDescriptionGetMediaSubType($0) == kAudioFormatMPEG4AAC
        }) else { throw DropPlaybackError.unsupported }
      }
      try current(token, id: id)
      duration = seconds
      activeMediaType = record.mediaType
      completedAt = record.completedAt
      position = PlaybackPolicy.restored(position: record.position, duration: seconds,
        wasCompleted: record.completedAt != nil)
      let item = AVPlayerItem(asset: asset)
      player.replaceCurrentItem(with: item)
      let artworkURL: URL?
      if record.relativeArtworkPath == "Artwork/\(id).jpg" {
        artworkURL = (try? storage.managedArtwork(id: id))?.0
      } else {
        artworkURL = nil
      }
      system.setItem(token: token,
        title: String(record.title.prefix(240)).trimmingCharacters(in: .whitespacesAndNewlines),
        artworkURL: artworkURL, duration: seconds, position: position, rate: 0) {
          [weak self] eventToken, event in
          await self?.handleSystemEvent(token: eventToken, event: event)
        }
      observe(item: item, token: token, restorePosition: position)
      return snapshot()
    } catch {
      if token == generation {
        try? await retireCurrent()
        state = "failed"
        errorCode = (error as? DropPlaybackError)?.code ?? "OPEN_FAILED"
        emit()
      }
      throw error
    }
  }

  private func current(_ token: UInt64, id: String) throws {
    guard token == generation, leases.owns(id) else { throw DropPlaybackError.superseded }
  }

  private func observe(item: AVPlayerItem, token: UInt64, restorePosition: Double) {
    statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation, self.player.currentItem === item else { return }
        switch item.status {
        case .readyToPlay where self.state == "loading":
          if restorePosition > 0 {
            await self.seekPlayer(to: restorePosition, token: token)
          }
          guard token == self.generation else { return }
          self.state = "ready"
          self.emit()
          self.updateNowPlaying()
        case .failed:
          await self.failCurrent(.invalidMedia, token: token)
        default: break
        }
      }
    }
    endObservation = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation else { return }
        self.position = self.duration ?? self.position
        self.completedAt = ISO8601DateFormatter().string(from: Date())
        self.state = "ended"
        self.dirty = true
        self.emit()
        self.updateNowPlaying()
        if let pendingSave = self.pendingSave { await pendingSave.value }
        guard token == self.generation else { return }
        try? await self.persist()
      }
    }
    failureObservation = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation else { return }
        await self.failCurrent(.invalidMedia, token: token)
      }
    }
    #if canImport(UIKit)
    timeJumpObservation = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.timeJumpedNotification, object: item, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation,
              self.fullscreenController != nil,
              self.player.currentItem === item,
              ["ready", "paused", "playing", "ended"].contains(self.state)
        else { return }
        self.position = self.safeCurrentPosition()
        if let duration = self.duration, self.completedAt != nil,
           !PlaybackPolicy.completed(position: self.position, duration: duration) {
          self.completedAt = nil
        }
        if self.state == "ended" { self.state = "paused" }
        self.dirty = true
        self.emit()
        self.updateNowPlaying()
        do { try await self.persist() }
        catch { self.errorCode = "PROGRESS_SAVE_FAILED"; self.emit() }
      }
    }
    #endif
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation,
              self.state == "playing", let duration = self.duration else { return }
        let value = CMTimeGetSeconds(time)
        guard let bounded = PlaybackPolicy.clamped(value, duration: duration) else { return }
        guard abs(bounded - self.position) >= 0.25 else { return }
        self.position = bounded
        self.dirty = true
        if PlaybackPolicy.completed(position: bounded, duration: duration),
           self.completedAt == nil {
          self.completedAt = ISO8601DateFormatter().string(from: Date())
        }
        self.emit()
        if Date().timeIntervalSince(self.lastNowPlayingUpdate) >= 15 {
          self.updateNowPlaying()
        }
        if PlaybackPolicy.shouldPersist(
          elapsed: Date().timeIntervalSince(self.lastSave), hasProgress: self.dirty
        ), self.pendingSave == nil {
          self.lastSave = Date()
          self.pendingSave = Task { @MainActor [weak self] in
            guard let self, token == self.generation else { return }
            do { try await self.persist() }
            catch {
              if token == self.generation {
                self.errorCode = "PROGRESS_SAVE_FAILED"
                self.emit()
              }
            }
            if token == self.generation { self.pendingSave = nil }
          }
        }
      }
    }
  }

  private func seekPlayer(to seconds: Double, token: UInt64) async {
    await withCheckedContinuation { continuation in
      player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600),
        toleranceBefore: .zero, toleranceAfter: .zero) { _ in
        continuation.resume()
      }
    }
  }

  func play() async throws -> [String: Any] {
    guard player.currentItem != nil,
          ["ready", "paused", "ended", "interrupted"].contains(state) else {
      throw DropPlaybackError.notReady
    }
    let token = generation
    do { try system.activate() }
    catch {
      await failCurrent(.audioSession, token: token)
      throw DropPlaybackError.audioSession
    }
    if state == "ended" {
      await seekPlayer(to: 0, token: token)
      guard token == generation else { throw DropPlaybackError.superseded }
      position = 0
    }
    if completedAt != nil && duration.map({ !PlaybackPolicy.completed(position: position, duration: $0) }) == true {
      completedAt = nil
      dirty = true
    }
    player.defaultRate = Float(rate)
    player.playImmediately(atRate: Float(rate))
    state = "playing"
    wasPlayingBeforeInterruption = false
    lastSave = Date()
    emit()
    updateNowPlaying()
    return snapshot()
  }

  func pause() async throws -> [String: Any] {
    guard player.currentItem != nil else { throw DropPlaybackError.notReady }
    let token = generation
    player.pause()
    if state == "playing" || state == "interrupted" { state = "paused" }
    wasPlayingBeforeInterruption = false
    position = safeCurrentPosition()
    dirty = true
    if let pendingSave { await pendingSave.value }
    guard token == generation else { throw DropPlaybackError.superseded }
    try await persist()
    emit()
    updateNowPlaying()
    return snapshot()
  }

  func seek(_ requested: Double) async throws -> [String: Any] {
    guard let duration, player.currentItem != nil else { throw DropPlaybackError.notReady }
    guard let target = PlaybackPolicy.clamped(requested, duration: duration) else {
      throw DropPlaybackError.invalidPosition
    }
    let token = generation
    await seekPlayer(to: target, token: token)
    guard token == generation else { throw DropPlaybackError.superseded }
    position = target
    if completedAt != nil && !PlaybackPolicy.completed(position: target, duration: duration) {
      completedAt = nil
    }
    if state == "ended" { state = "paused" }
    dirty = true
    if let pendingSave { await pendingSave.value }
    guard token == generation else { throw DropPlaybackError.superseded }
    try await persist()
    emit()
    updateNowPlaying()
    return snapshot()
  }

  func skip(_ offset: Double) async throws -> [String: Any] {
    guard offset.isFinite else { throw DropPlaybackError.invalidPosition }
    return try await seek(safeCurrentPosition() + offset)
  }

  func setRate(_ value: Double) throws -> [String: Any] {
    guard PlaybackPolicy.rates.contains(value) else { throw DropPlaybackError.invalidRate }
    rate = value
    player.defaultRate = Float(value)
    if state == "playing" { player.rate = Float(value) }
    emit()
    updateNowPlaying()
    return snapshot()
  }

  #if canImport(UIKit)
  func enterFullscreen() async throws -> [String: Any] {
    guard activeMediaType == "video", player.currentItem != nil,
          ["ready", "paused", "playing", "ended"].contains(state) else {
      throw DropPlaybackError.notReady
    }
    if fullscreenController != nil { return snapshot() }
    guard let scene = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive }),
      let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
    else { throw DropPlaybackError.unavailable }
    var presenter = root
    while let presented = presenter.presentedViewController { presenter = presented }
    let controller = DropPlaybackFullscreenController()
    controller.player = player
    controller.speeds = PlaybackPolicy.rates.map {
      AVPlaybackSpeed(rate: Float($0), localizedName: "\($0)×")
    }
    controller.allowsPictureInPicturePlayback = false
    controller.canStartPictureInPictureAutomaticallyFromInline = false
    controller.modalPresentationStyle = .fullScreen
    controller.didDisappear = { [weak self, weak controller] in
      Task { @MainActor [weak self, weak controller] in
        guard let self, self.fullscreenController === controller else { return }
        self.restoreInline()
      }
    }
    fullscreenController = controller
    DropPlaybackOrientation.fullscreen = true
    root.setNeedsUpdateOfSupportedInterfaceOrientations()
    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { _ in }
    await withCheckedContinuation { continuation in
      presenter.present(controller, animated: true) { continuation.resume() }
    }
    emit()
    updateNowPlaying()
    return snapshot()
  }

  func exitFullscreen() async -> [String: Any] {
    if let controller = fullscreenController,
       controller.presentingViewController != nil {
      await withCheckedContinuation { continuation in
        controller.dismiss(animated: true) { continuation.resume() }
      }
    }
    restoreInline()
    return snapshot()
  }

  private func restoreInline() {
    guard fullscreenController != nil || DropPlaybackOrientation.fullscreen else { return }
    let selected = Double(player.defaultRate)
    if PlaybackPolicy.rates.contains(selected) { rate = selected }
    fullscreenController?.didDisappear = nil
    fullscreenController?.player = nil
    fullscreenController = nil
    DropPlaybackOrientation.fullscreen = false
    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
      scene.windows.first(where: { $0.isKeyWindow })?.rootViewController?
        .setNeedsUpdateOfSupportedInterfaceOrientations()
      if scene.activationState == .foregroundActive {
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
      }
    }
    emit()
  }
  #endif

  func close() async throws -> [String: Any] {
    generation &+= 1
    try await retireCurrent()
    state = "idle"
    errorCode = nil
    emit()
    return snapshot()
  }

  func beginDelete(_ id: String) async throws {
    guard UUID(uuidString: id) != nil else { throw DropPlaybackError.invalidID }
    if leases.beginDelete(id) {
      generation &+= 1
      do { try await retireCurrent() }
      catch { leases.endDelete(id); throw error }
      state = "idle"
      errorCode = nil
      emit()
    }
  }

  func endDelete(_ id: String) { leases.endDelete(id) }

  private func safeCurrentPosition() -> Double {
    guard let duration,
          let current = PlaybackPolicy.clamped(CMTimeGetSeconds(player.currentTime()), duration: duration)
    else { return position }
    return current
  }

  private func persist() async throws {
    guard dirty, let id = activeID, let repository else { return }
    let saved = position
    let completed = completedAt
    try await repository.save(id: id, position: saved, completedAt: completed)
    if activeID == id && position == saved && completedAt == completed { dirty = false }
  }

  private func updateNowPlaying() {
    guard activeID != nil else { return }
    system.update(position: safeCurrentPosition(), rate: state == "playing" ? rate : 0)
    lastNowPlayingUpdate = Date()
  }

  func handleSystemEvent(token: UInt64, event: PlaybackSystemEvent) async {
    guard token == generation, activeID != nil, player.currentItem != nil else { return }
    switch event {
    case .play:
      guard ["ready", "paused", "ended"].contains(state) else { return }
      _ = try? await play()
    case .pause:
      guard ["playing", "interrupted"].contains(state) else { return }
      _ = try? await pause()
    case .skip(let seconds):
      _ = try? await skip(seconds)
    case .seek(let seconds):
      _ = try? await seek(seconds)
    case .interruptionBegan:
      wasPlayingBeforeInterruption = state == "playing"
      guard wasPlayingBeforeInterruption else { return }
      player.pause()
      state = "interrupted"
      position = safeCurrentPosition()
      dirty = true
      emit()
      updateNowPlaying()
      if let pendingSave { await pendingSave.value }
      guard token == generation else { return }
      do { try await persist() }
      catch { errorCode = "PROGRESS_SAVE_FAILED"; emit() }
    case .interruptionEnded(let shouldResume):
      let resume = shouldResume && wasPlayingBeforeInterruption && state == "interrupted"
      wasPlayingBeforeInterruption = false
      if state == "interrupted" { state = "paused"; emit(); updateNowPlaying() }
      if resume { _ = try? await play() }
    case .oldDeviceUnavailable:
      wasPlayingBeforeInterruption = false
      if state == "playing" || state == "interrupted" { _ = try? await pause() }
    case .newDeviceAvailable:
      break // Connecting an output never starts playback.
    }
  }

  private func retireCurrent() async throws {
    #if canImport(UIKit)
    await exitFullscreen()
    #endif
    let id = activeID
    let finalPosition = safeCurrentPosition()
    statusObservation = nil
    if let endObservation { NotificationCenter.default.removeObserver(endObservation) }
    endObservation = nil
    if let failureObservation { NotificationCenter.default.removeObserver(failureObservation) }
    failureObservation = nil
    #if canImport(UIKit)
    if let timeJumpObservation { NotificationCenter.default.removeObserver(timeJumpObservation) }
    timeJumpObservation = nil
    #endif
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    timeObserver = nil
    player.pause()
    player.replaceCurrentItem(with: nil)
    system.clear()
    wasPlayingBeforeInterruption = false
    position = finalPosition
    if id != nil { dirty = dirty || state == "playing" || state == "paused" }
    if let pendingSave { await pendingSave.value }
    pendingSave = nil
    defer {
      activeID = nil
      activeMediaType = nil
      if let id { leases.release(id) }
      position = 0
      duration = nil
      completedAt = nil
      dirty = false
    }
    if id != nil { try await persist() }
  }

  private func failCurrent(_ error: DropPlaybackError, token: UInt64) async {
    guard token == generation else { return }
    generation &+= 1
    try? await retireCurrent()
    state = "failed"
    errorCode = error.code
    emit()
  }
}
