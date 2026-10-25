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
  case pipUnavailable

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
    case .pipUnavailable: return "PIP_UNAVAILABLE"
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
    case .pipUnavailable: return "Picture in Picture no está disponible ahora."
    }
  }
}

@MainActor
final class DropPlaybackService {
  static let shared = DropPlaybackService()

  // AVQueuePlayer is an AVPlayer: every inline, fullscreen and PiP surface
  // keeps using this one transport object.
  let player: AVQueuePlayer
  var onState: (([String: Any]) -> Void)?

  private var repository: PlaybackProgressRepository?
  private var storage: DropLibraryStorage?
  private let system: PlaybackSystemBridge
  private let ratePreference: PlaybackRatePreference
  private var generation: UInt64 = 0
  private var playbackContext: PlaybackContext?
  private var contextEpoch: UInt64 = 0
  private var pendingAutoplayToken: UInt64?
  private struct PreparedNext {
    let occurrence: PlaybackOccurrence
    let generation: UInt64
    let preparationSerial: UInt64
    var id: String { occurrence.libraryID }
    let item: AVPlayerItem
    let mediaType: String
    let duration: Double
    let position: Double
    let completedAt: String?
    let title: String
    let artworkURL: URL?
  }
  private var preparedNext: PreparedNext?
  private var preparingItem: AVPlayerItem?
  private var preparedStatusObservation: NSKeyValueObservation?
  private var preparationTask: Task<Void, Never>?
  private var preparationSerial: UInt64 = 0
  private var nextCandidateIndex = 0
  private var completionScheduled = false
  private let progressWrites = PlaybackProgressWriteCoordinator()
  private var queuedAdvanceAt = Date.distantPast
  private var currentItemObservation: NSKeyValueObservation?
  private let leases = PlaybackLeaseCoordinator()
  private var currentOccurrence: PlaybackOccurrence?
  private var currentOccurrenceItem: AVPlayerItem?
  private var activeID: String?
  private var activeMediaType: String?
  #if canImport(UIKit)
  private struct PiPRestoreIntent {
    let id: String
    let generation: UInt64
    let item: AVPlayerItem
    let transportEpoch: UInt64
    let selectedRate: Double
  }
  private struct FullscreenDismissIntent {
    let id: String
    let generation: UInt64
    let item: AVPlayerItem
    let transportEpoch: UInt64
    let selectedRate: Double
    let wasPlaying: Bool
  }
  private var transportEpoch: UInt64 = 0
  private var pipRestoreIntent: PiPRestoreIntent?
  private var fullscreenDismissIntent: FullscreenDismissIntent?
  private var pendingPiPStopReason: DropPiPStopReason = .replacement
  private var fullscreenController: AVPlayerViewController?
  private lazy var pip: DropPlaybackPiPCoordinator = {
    let coordinator = DropPlaybackPiPCoordinator()
    coordinator.onChange = { [weak self, weak coordinator] in
      guard let self, let coordinator else { return }
      if coordinator.ownsFullscreenPiP { self.fullscreenDismissIntent = nil }
      coordinator.updateAutomaticStart(playing: self.state == "playing",
        inlineVisible: self.fullscreenController == nil && coordinator.sourceLayer != nil)
      self.emit()
    }
    coordinator.onSystemStop = { [weak self] token, reason in
      guard let self, token == self.generation else { return }
      // Explicit replacement/Delete already owns the stop-and-retire path.
      // A second close here would invalidate the next item during auto-next.
      guard reason == .systemStop || reason == .failure else { return }
      // A system stop without a completed UI restoration is never hidden audio.
      Task { @MainActor [weak self] in
        guard let self, token == self.generation else { return }
        _ = try? await self.close()
      }
    }
    coordinator.onRestore = { [weak self] token in
      guard let self, token == self.generation, let id = self.activeID else { return }
      // Snapshot effective playback before AVKit hands the PiP surface back.
      // AVKit can set rate to zero while stopping PiP; that is not a user pause.
      if let item = self.player.currentItem,
         self.state == "playing", self.player.rate > 0,
         self.player.timeControlStatus == .playing {
        self.pipRestoreIntent = PiPRestoreIntent(id: id, generation: token,
          item: item, transportEpoch: self.transportEpoch, selectedRate: self.rate)
      } else {
        self.pipRestoreIntent = nil
      }
      self.onRestore?(id)
    }
    coordinator.onRestoreStopped = { [weak self] token in
      guard let self else { return }
      // Wait until AVKit's didStop handoff and queued rate observation settle.
      Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: 100_000_000)
        self?.restoreEffectivePlayback(token: token)
      }
    }
    coordinator.onFullscreenDismissWillBegin = { [weak self] in
      self?.captureFullscreenDismissIntent()
    }
    coordinator.onFullscreenDismissCancelled = { [weak self] in
      self?.finishFullscreenDismiss(completed: false)
    }
    coordinator.onFullscreenDismiss = { [weak self] in
      self?.finishFullscreenDismiss(completed: true)
    }
    return coordinator
  }()
  var onRestore: ((String) -> Void)?
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
  private var defaultRateObservation: NSKeyValueObservation?
  private var timeJumpObservation: NSObjectProtocol?
  #endif
  private var pendingSave: Task<Void, Never>?

  init(player: AVQueuePlayer = AVQueuePlayer(), storage: DropLibraryStorage? = nil,
       repository: PlaybackProgressRepository? = nil,
       system: PlaybackSystemBridge? = nil,
       ratePreference: PlaybackRatePreference? = nil) {
    self.player = player
    self.storage = storage
    self.repository = repository
    self.system = system ?? IOSPlaybackSystemBridge()
    self.ratePreference = ratePreference ?? UserDefaultsPlaybackRatePreference()
    let storedRate = self.ratePreference.load()
    rate = storedRate.flatMap { PlaybackPolicy.rates.contains($0) ? $0 : nil } ?? 1
    player.defaultRate = Float(rate)
    player.actionAtItemEnd = .advance
    #if os(iOS)
    player.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
    #endif
    currentItemObservation = player.observe(\.currentItem, options: [.new]) {
      [weak self] queue, _ in
      let observedItem = queue.currentItem
      Task { @MainActor [weak self] in
        guard let self, let observedItem,
              self.player.currentItem === observedItem else { return }
        self.adoptQueuedItem(observedItem)
      }
    }
    #if canImport(UIKit)
    defaultRateObservation = player.observe(\.defaultRate, options: [.new]) {
      [weak self] player, _ in
      let observedItem = player.currentItem
      Task { @MainActor [weak self] in
        guard let self, let observedItem,
              self.player.currentItem === observedItem else { return }
        let selected = Double(player.defaultRate)
        guard PlaybackPolicy.rates.contains(selected), self.rate != selected else { return }
        if self.preparedNext?.item === observedItem ||
            Date().timeIntervalSince(self.queuedAdvanceAt) < 0.5 {
          // AVQueuePlayer may reset defaultRate while advancing. The queued
          // handoff is not a user preference change.
          self.player.defaultRate = Float(self.rate)
          return
        }
        self.selectRate(selected)
      }
    }
    rateObservation = player.observe(\.rate, options: [.new]) { [weak self] player, _ in
      let observedItem = player.currentItem
      Task { @MainActor [weak self] in
        guard let self,
              let observedItem,
              self.player.currentItem === observedItem else { return }
        self.reconcileQueuedItem()
        if player.rate > 0 {
          let selected = Double(player.rate)
          if PlaybackPolicy.rates.contains(selected), self.rate != selected,
             Date().timeIntervalSince(self.queuedAdvanceAt) >= 0.5 {
            self.selectRate(selected)
            self.player.defaultRate = Float(selected)
          }
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
          self.pip.updateAutomaticStart(playing: true,
            inlineVisible: self.fullscreenController == nil && self.pip.sourceLayer != nil)
        } else if self.state == "playing" && player.timeControlStatus == .paused {
          // AVQueuePlayer can briefly report rate zero while advancing to a
          // prequeued item. A real pause still settles and is observed below.
          if Date().timeIntervalSince(self.queuedAdvanceAt) < 0.25 {
            Task { @MainActor [weak self] in
              try? await Task.sleep(nanoseconds: 300_000_000)
              self?.reconcileEffectivePause(item: observedItem)
            }
            return
          }
          self.reconcileEffectivePause(item: observedItem)
          self.pip.updateAutomaticStart(playing: false, inlineVisible: false)
        }
      }
    }
    #endif
  }

  func snapshot() -> [String: Any] {
    var result: [String: Any] = ["libraryId": activeID as Any? ?? NSNull(), "status": state,
     "position": position, "duration": duration as Any? ?? NSNull(),
     "rate": rate, "playable": player.currentItem != nil &&
       ["ready", "paused", "playing", "ended"].contains(state),
     "fullscreen": fullscreenActive,
     "completed": completedAt != nil,
     "errorCode": errorCode as Any? ?? NSNull()]
    #if canImport(UIKit)
    result["pipPresentation"] = pip.presentation.rawValue
    result["pipSupported"] = pip.isSupported
    result["pipAvailable"] = pip.canStartInline
    #endif
    return result
  }

  private func emit() { onState?(snapshot()) }

  private func selectRate(_ selected: Double) {
    guard PlaybackPolicy.rates.contains(selected), rate != selected else { return }
    rate = selected
    ratePreference.save(selected)
    emit()
    updateNowPlaying()
  }

  private var fullscreenActive: Bool {
    #if canImport(UIKit)
    fullscreenController != nil
    #else
    false
    #endif
  }

  func isRetaining(_ id: String) -> Bool { leases.retains(id) }

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
    reconcileQueuedItem()
    contextEpoch &+= 1
    playbackContext = nil
    cancelPreparation()
    await drainPreparation()
    return try await openManaged(id: id)
  }

  func startInContext(id: String, orderedIds: [String]) async throws -> [String: Any] {
    reconcileQueuedItem()
    let newContext: PlaybackContext
    do { newContext = try PlaybackContext(startID: id, orderedIds: orderedIds) }
    catch { throw DropPlaybackError.invalidID }
    contextEpoch &+= 1
    let epoch = contextEpoch
    playbackContext = nil
    cancelPreparation()
    await drainPreparation()
    guard epoch == contextEpoch else { throw DropPlaybackError.superseded }
    if activeID == id, player.currentItem != nil,
       ["loading", "ready", "paused", "playing", "ended"].contains(state) {
      playbackContext = newContext
      nextCandidateIndex = newContext.currentIndex + 1
      scheduleNextPreparation()
      if state == "playing" { return snapshot() }
      return try await requestAutoplay(token: generation)
    }
    _ = try await openManaged(id: id)
    guard epoch == contextEpoch, activeID == id, player.currentItem != nil else {
      throw DropPlaybackError.superseded
    }
    playbackContext = newContext
    nextCandidateIndex = newContext.currentIndex + 1
    scheduleNextPreparation()
    return try await requestAutoplay(token: generation)
  }

  private func openManaged(id: String) async throws -> [String: Any] {
    guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else {
      throw DropPlaybackError.invalidID
    }
    guard !leases.isDeleting(id) else { throw DropPlaybackError.unavailable }
    pendingAutoplayToken = nil
    generation &+= 1
    #if canImport(UIKit)
    pipRestoreIntent = nil
    fullscreenDismissIntent = nil
    #endif
    let token = generation
    try await retireCurrent()
    guard token == generation, !leases.isDeleting(id) else {
      throw DropPlaybackError.superseded
    }
    // Reserve before any asynchronous database or asset work. Delete first blocks
    // new opens, then closes this reserved lease before removing the file.
    let occurrence = PlaybackOccurrence(libraryID: id, source: .direct)
    guard leases.reserveCurrent(occurrence) else { throw DropPlaybackError.unavailable }
    currentOccurrence = occurrence
    progressWrites.activate(occurrence)
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
      // A just-completed item can be selected again immediately. All writes
      // already accepted for that Library row finish before its progress loads.
      await progressWrites.drain(id)
      try current(token, id: id)
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
      #if canImport(UIKit)
      pip.configure(token: token, mediaType: record.mediaType, player: player)
      #endif
      completedAt = record.completedAt
      completionScheduled = false
      position = PlaybackPolicy.restored(position: record.position, duration: seconds,
        wasCompleted: record.completedAt != nil)
      let item = AVPlayerItem(asset: asset)
      guard player.canInsert(item, after: nil) else { throw DropPlaybackError.invalidMedia }
      player.insert(item, after: nil)
      currentOccurrenceItem = item
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
    guard token == generation, activeID == id,
          let currentOccurrence, currentOccurrence.libraryID == id,
          leases.ownsCurrent(currentOccurrence) else { throw DropPlaybackError.superseded }
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
          if self.pendingAutoplayToken == token {
            self.pendingAutoplayToken = nil
            do {
              _ = try await self.play()
            } catch {
              if token == self.generation {
                await self.failCurrent(.invalidMedia, token: token)
              }
            }
          }
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
        guard let self, token == self.generation,
              self.currentOccurrenceItem === item,
              let id = self.activeID, let duration = self.duration else { return }
        // AVQueuePlayer advances to a prepared successor itself. This callback
        // never opens or plays the next item. If one is queued, its adoption
        // schedules this save only after AVFoundation has advanced to it.
        guard self.preparedNext == nil else { return }
        self.scheduleCompletedSave(id: id, duration: duration)
        self.cancelPreparation()
        self.position = duration
        self.completedAt = ISO8601DateFormatter().string(from: Date())
        self.state = "ended"
        self.dirty = false
        self.emit()
        self.updateNowPlaying()
        #if canImport(UIKit)
        if self.activeMediaType == "video", self.pip.isActiveOrTransitioning {
          self.pendingPiPStopReason = .itemEnded
          _ = try? await self.close()
        }
        #endif
      }
    }
    failureObservation = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation,
              self.currentOccurrenceItem === item else { return }
        await self.failCurrent(.invalidMedia, token: token)
      }
    }
    #if canImport(UIKit)
    timeJumpObservation = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.timeJumpedNotification, object: item, queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, token == self.generation,
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
              self.player.currentItem === item,
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
          let observedOccurrence = self.currentOccurrence
          self.pendingSave = Task { @MainActor [weak self] in
            guard let self, token == self.generation,
                  let observedOccurrence,
                  self.currentOccurrence == observedOccurrence else { return }
            do { try await self.persist(expected: observedOccurrence) }
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

  private func clearItemObservers() {
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
  }

  private func seekPlayer(to seconds: Double, token: UInt64) async {
    await withCheckedContinuation { continuation in
      player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600),
        toleranceBefore: .zero, toleranceAfter: .zero) { _ in
        continuation.resume()
      }
    }
  }

  private func requestAutoplay(token: UInt64) async throws -> [String: Any] {
    guard token == generation else { throw DropPlaybackError.superseded }
    if state == "playing" { return snapshot() }
    if state == "loading" {
      pendingAutoplayToken = token
      return snapshot()
    }
    return try await play()
  }

  private func cancelPreparation() {
    // An AVQueuePlayer handoff may precede its KVO callback. Adopt that exact
    // item before cancelling so its occurrence is never released as NEXT.
    if let next = preparedNext, player.currentItem === next.item {
      adoptQueuedItem(next.item)
    }
    preparationSerial &+= 1
    preparationTask?.cancel()
    preparingItem?.cancelPendingSeeks()
    if let preparedNext {
      if player.currentItem !== preparedNext.item {
        player.remove(preparedNext.item)
        leases.releasePrepared(preparedNext.occurrence)
      }
      self.preparedNext = nil
    }
    preparedStatusObservation = nil
  }

  private func drainPreparation() async {
    if let task = preparationTask { await task.value }
    preparationTask = nil
  }

  private func scheduleNextPreparation() {
    guard preparedNext == nil, preparationTask == nil,
          playbackContext != nil, player.currentItem != nil,
          state != "ended" else { return }
    let epoch = contextEpoch
    let token = generation
    let serial = preparationSerial
    preparationTask = Task { @MainActor [weak self] in
      await self?.prepareNext(epoch: epoch, token: token, serial: serial)
    }
  }

  private func preparationIsCurrent(epoch: UInt64, token: UInt64, serial: UInt64,
                                    source: AVPlayerItem) -> Bool {
    epoch == contextEpoch && token == generation && serial == preparationSerial &&
      !Task.isCancelled && player.currentItem === source && state != "ended"
  }

  private func prepareNext(epoch: UInt64, token: UInt64, serial: UInt64) async {
    defer { if serial == preparationSerial { preparationTask = nil } }
    guard let source = player.currentItem else { return }
    while preparationIsCurrent(epoch: epoch, token: token, serial: serial, source: source),
          let context = playbackContext,
          nextCandidateIndex < context.orderedIds.count {
      let candidateIndex = nextCandidateIndex
      let id = context.orderedIds[candidateIndex]
      nextCandidateIndex += 1 // Each candidate is attempted at most once.
      let occurrence = PlaybackOccurrence(libraryID: id,
        source: .context(index: candidateIndex))
      guard leases.reservePrepared(occurrence) else { continue }
      do {
        let next = try await validatedNext(id: id, occurrence: occurrence,
          token: token, serial: serial)
        guard preparationIsCurrent(epoch: epoch, token: token, serial: serial,
                                   source: source), leases.ownsPrepared(occurrence) else {
          leases.releasePrepared(occurrence)
          return
        }
        // AVPlayerItem.seek is independent of the player. Complete the restore
        // before enqueueing, so AVFoundation never starts B audibly at zero.
        if next.position > 0 {
          let target = CMTime(seconds: next.position, preferredTimescale: 600)
          preparingItem = next.item
          let restored = await next.item.seek(to: target, toleranceBefore: .zero,
                                              toleranceAfter: .zero)
          if preparingItem === next.item { preparingItem = nil }
          guard restored else {
            throw DropPlaybackError.invalidMedia
          }
        }
        guard preparationIsCurrent(epoch: epoch, token: token, serial: serial,
                                   source: source), leases.ownsPrepared(occurrence) else {
          leases.releasePrepared(occurrence)
          return
        }
        guard player.canInsert(next.item, after: source) else {
          throw DropPlaybackError.invalidMedia
        }
        preparedNext = next
        preparedStatusObservation = next.item.observe(\.status, options: [.new]) {
          [weak self] item, _ in
          Task { @MainActor [weak self] in
            guard let self, self.preparedNext?.item === item,
                  self.preparedNext?.occurrence == occurrence,
                  self.preparedNext?.generation == token,
                  self.preparedNext?.preparationSerial == serial,
                  self.generation == token, self.preparationSerial == serial,
                  item.status == .failed,
                  self.player.currentItem !== item else { return }
            self.cancelPreparation()
            self.preparationTask = nil
            self.scheduleNextPreparation()
          }
        }
        player.insert(next.item, after: source)
        return
      } catch {
        leases.releasePrepared(occurrence)
      }
    }
  }

  private func validatedNext(id: String, occurrence: PlaybackOccurrence,
                             token: UInt64, serial: UInt64) async throws -> PreparedNext {
    let (storage, repository) = try resources()
    await progressWrites.drain(id)
    let record = try await repository.load(id: id)
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
    guard playable, !tracks.isEmpty, PlaybackPolicy.validDuration(seconds) else {
      throw DropPlaybackError.invalidMedia
    }
    if record.mediaType == "audio" {
      let descriptions = try await tracks[0].load(.formatDescriptions)
      guard descriptions.contains(where: {
        CMFormatDescriptionGetMediaSubType($0) == kAudioFormatMPEG4AAC
      }) else { throw DropPlaybackError.unsupported }
    }
    let artworkURL = record.relativeArtworkPath == "Artwork/\(id).jpg"
      ? (try? storage.managedArtwork(id: id))?.0 : nil
    return PreparedNext(occurrence: occurrence, generation: token,
      preparationSerial: serial, item: AVPlayerItem(asset: asset),
      mediaType: record.mediaType, duration: seconds,
      position: PlaybackPolicy.restored(position: record.position, duration: seconds,
        wasCompleted: record.completedAt != nil), completedAt: record.completedAt,
      title: String(record.title.prefix(240)).trimmingCharacters(in: .whitespacesAndNewlines),
      artworkURL: artworkURL)
  }

  private func scheduleCompletedSave(id: String, duration: Double) {
    guard !completionScheduled, let repository,
          let occurrence = currentOccurrence, occurrence.libraryID == id else { return }
    let priorSave = pendingSave
    let completed = ISO8601DateFormatter().string(from: Date())
    let snapshot = PlaybackProgressWrite(occurrence: occurrence,
      position: duration, completedAt: completed)
    guard let write = progressWrites.enqueue(snapshot, repository: repository,
      after: priorSave) else { return }
    completionScheduled = true
    pendingSave = nil // The outgoing task must not suppress the next item's saves.
    Task { @MainActor [weak self] in
      do { try await write.value }
      catch {
        if let self, self.currentOccurrence == occurrence {
          self.errorCode = "PROGRESS_SAVE_FAILED"
          self.emit()
        }
      }
    }
  }

  private func adoptQueuedItem(_ item: AVPlayerItem) {
    guard let next = preparedNext, next.item === item,
          next.generation == generation,
          next.preparationSerial == preparationSerial,
          let priorID = activeID, let priorDuration = duration,
          let priorOccurrence = currentOccurrence,
          priorOccurrence.libraryID == priorID,
          playbackContext?.currentID == priorID,
          leases.promotePrepared(next.occurrence, replacing: priorOccurrence) else { return }
    scheduleCompletedSave(id: priorID, duration: priorDuration)
    clearItemObservers()
    preparedStatusObservation = nil
    preparedNext = nil
    preparationSerial &+= 1
    preparationTask = nil
    _ = playbackContext?.promote(next.id)
    nextCandidateIndex = (playbackContext?.currentIndex ?? 0) + 1
    generation &+= 1
    let token = generation
    progressWrites.retire(priorOccurrence)
    progressWrites.activate(next.occurrence)
    currentOccurrence = next.occurrence
    currentOccurrenceItem = next.item
    activeID = next.id
    activeMediaType = next.mediaType
    duration = next.duration
    position = next.position
    // A completed item is replayed from zero; its completion marker is cleared
    // only after playback actually begins, never merely by prequeueing it.
    completedAt = next.completedAt
    completionScheduled = false
    state = player.rate > 0 || state == "playing" ? "playing" : "paused"
    queuedAdvanceAt = Date()
    lastSave = Date()
    wasPlayingBeforeInterruption = false
    if state == "playing" && completedAt != nil {
      completedAt = nil
      dirty = true
    } else { dirty = false }
    errorCode = nil
    #if canImport(UIKit)
    if next.mediaType == "audio", pip.isActiveOrTransitioning {
      // An audio-only successor keeps playing, but its old video PiP window
      // must finish before the coordinator returns to the closed presentation.
      Task { @MainActor [weak self] in
        guard let self, token == self.generation else { return }
        do { try await self.pip.stop(reason: .replacement) }
        catch {
          if token == self.generation { self.errorCode = "PIP_UNAVAILABLE"; self.emit() }
          return
        }
        guard token == self.generation else { return }
        self.pip.configure(token: token, mediaType: next.mediaType, player: self.player)
      }
    } else {
      pip.configure(token: token, mediaType: next.mediaType, player: player)
    }
    #endif
    system.setItem(token: token, title: next.title, artworkURL: next.artworkURL,
      duration: next.duration, position: next.position,
      rate: state == "playing" ? rate : 0) { [weak self] eventToken, event in
        await self?.handleSystemEvent(token: eventToken, event: event)
      }
    observe(item: item, token: token, restorePosition: 0)
    emit()
    updateNowPlaying()
    scheduleNextPreparation()
  }

  private func reconcileEffectivePause(item: AVPlayerItem) {
    guard player.currentItem === item, state == "playing", player.rate <= 0,
          player.timeControlStatus == .paused else { return }
    state = "paused"
    position = safeCurrentPosition()
    dirty = true
    emit()
    updateNowPlaying()
    let token = generation
    let occurrence = currentOccurrence
    Task { @MainActor [weak self] in
      guard let self, token == self.generation,
            self.player.currentItem === item,
            let occurrence, self.currentOccurrence == occurrence else { return }
      do { try await self.persist(expected: occurrence) }
      catch { self.errorCode = "PROGRESS_SAVE_FAILED"; self.emit() }
    }
  }

  func play() async throws -> [String: Any] {
    reconcileQueuedItem()
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
    #if canImport(UIKit)
    pip.updateAutomaticStart(playing: true,
      inlineVisible: fullscreenController == nil && pip.sourceLayer != nil)
    #endif
    return snapshot()
  }

  func pause() async throws -> [String: Any] {
    reconcileQueuedItem()
    guard player.currentItem != nil else { throw DropPlaybackError.notReady }
    let token = generation
    #if canImport(UIKit)
    transportEpoch &+= 1
    pipRestoreIntent = nil
    fullscreenDismissIntent = nil
    #endif
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
    #if canImport(UIKit)
    pip.updateAutomaticStart(playing: false, inlineVisible: false)
    #endif
    return snapshot()
  }

  func seek(_ requested: Double) async throws -> [String: Any] {
    reconcileQueuedItem()
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
    #if canImport(UIKit)
    if fullscreenDismissIntent != nil {
      transportEpoch &+= 1
      fullscreenDismissIntent = nil
    }
    #endif
    selectRate(value)
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
    let controller = AVPlayerViewController()
    controller.speeds = PlaybackPolicy.rates.map {
      AVPlaybackSpeed(rate: Float($0), localizedName: "\($0)×")
    }
    controller.modalPresentationStyle = .fullScreen
    try pip.enterFullscreen(controller)
    controller.player = player
    fullscreenController = controller
    pip.updateAutomaticStart(playing: state == "playing", inlineVisible: false)
    DropPlaybackOrientation.fullscreen = true
    root.setNeedsUpdateOfSupportedInterfaceOrientations()
    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { _ in }
    await withCheckedContinuation { continuation in
      presenter.present(controller, animated: true) { continuation.resume() }
    }
    controller.presentationController?.delegate = pip
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
    finishFullscreenDismiss(completed: true)
    return snapshot()
  }

  private func captureFullscreenDismissIntent() {
    guard fullscreenController != nil, !pip.ownsFullscreenPiP,
          fullscreenDismissIntent == nil, let id = activeID,
          let item = player.currentItem else { return }
    fullscreenDismissIntent = FullscreenDismissIntent(id: id, generation: generation,
      item: item, transportEpoch: transportEpoch, selectedRate: rate,
      wasPlaying: state == "playing" && player.rate > 0)
  }

  private func finishFullscreenDismiss(completed: Bool) {
    let intent = fullscreenDismissIntent
    fullscreenDismissIntent = nil
    if completed { restoreInline() }
    guard let intent, intent.wasPlaying else { return }
    // AVKit's rate and our KVO callback may settle just after the visual
    // handoff. Restore only the same effective playback, never autoplay.
    Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 100_000_000)
      self?.restoreEffectiveFullscreenPlayback(intent, completed: completed)
    }
  }

  private func restoreEffectiveFullscreenPlayback(_ intent: FullscreenDismissIntent,
    completed: Bool) {
    let settled = completed
      ? fullscreenController == nil && pip.presentation == .inline
      : fullscreenController != nil && pip.presentation == .fullscreen
    guard DropPiPPolicy.shouldResumeAfterFullscreenDismiss(
      sameGeneration: intent.generation == generation,
      sameID: activeID == intent.id,
      sameItem: player.currentItem === intent.item,
      unchangedIntent: transportEpoch == intent.transportEpoch,
      wasPlaying: intent.wasPlaying,
      safeState: state == "playing" || state == "paused",
      transitionSettled: settled
    ) else { return }
    player.defaultRate = Float(intent.selectedRate)
    if player.rate <= 0 {
      player.playImmediately(atRate: Float(intent.selectedRate))
    } else if abs(Double(player.rate) - intent.selectedRate) > 0.01 {
      player.rate = Float(intent.selectedRate)
    }
    rate = intent.selectedRate
    state = "playing"
    emit()
    updateNowPlaying()
  }

  private func restoreInline() {
    if pip.ownsFullscreenPiP { return }
    guard fullscreenController != nil || DropPlaybackOrientation.fullscreen else { return }
    // Detach fullscreen rendering before the PiP coordinator reconnects the
    // inline AVPlayerLayer. Dismissal itself belongs to UIKit/exitFullscreen.
    let controller = fullscreenController
    controller?.player = nil
    pip.leaveFullscreen()
    fullscreenController = nil
    DropPlaybackOrientation.fullscreen = false
    pip.updateAutomaticStart(playing: state == "playing",
      inlineVisible: pip.sourceLayer != nil)
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

  #if canImport(UIKit)
  func attachVideoSurface(_ surface: UIView) {
    pip.attach(surface, player: player)
    pip.updateAutomaticStart(playing: state == "playing", inlineVisible: true)
  }

  func detachVideoSurface(_ surface: UIView) { pip.detach(surface) }

  func startPiP() throws -> [String: Any] {
    guard activeMediaType == "video", player.currentItem != nil else {
      throw DropPlaybackError.notReady
    }
    try pip.startInline()
    return snapshot()
  }

  func completePiPRestore(_ restored: Bool) -> [String: Any] {
    if !restored { pipRestoreIntent = nil }
    pip.completeRestore(restored)
    return snapshot()
  }

  private func restoreEffectivePlayback(token: UInt64) {
    guard let intent = pipRestoreIntent else { return }
    pipRestoreIntent = nil
    guard DropPiPPolicy.shouldResumeAfterRestore(
      sameGeneration: token == generation && intent.generation == generation,
      sameID: activeID == intent.id,
      sameItem: player.currentItem === intent.item,
      unchangedIntent: transportEpoch == intent.transportEpoch,
      safeState: state == "playing" || state == "paused",
      restored: pip.presentation == .inline || pip.presentation == .fullscreen
    ) else { return }
    // AVKit may have paused the existing player when completing the PiP handoff.
    // This resumes only the playback that was effectively running beforehand.
    if player.rate <= 0 {
      player.defaultRate = Float(intent.selectedRate)
      player.playImmediately(atRate: Float(intent.selectedRate))
    }
    rate = intent.selectedRate
    state = "playing"
    emit()
    updateNowPlaying()
  }

  #endif

  func leavePlayerScreen(_ id: String) async throws -> [String: Any] {
    reconcileQueuedItem()
    guard activeID == id, player.currentItem != nil else { return snapshot() }
    // The route owns only its controls and video surface. Keep the item, lease,
    // transport and Now Playing alive; an explicit close/replacement/Delete
    // remains responsible for retiring the session.
    #if canImport(UIKit)
    pip.updateAutomaticStart(playing: state == "playing", inlineVisible: false)
    #endif
    let token = generation
    position = safeCurrentPosition()
    dirty = true
    if let pendingSave { await pendingSave.value }
    guard token == generation, activeID == id, player.currentItem != nil else {
      return snapshot()
    }
    try await persist()
    if token == generation, activeID == id { lastSave = Date() }
    return snapshot()
  }

  func close() async throws -> [String: Any] {
    reconcileQueuedItem()
    contextEpoch &+= 1
    playbackContext = nil
    pendingAutoplayToken = nil
    cancelPreparation()
    await drainPreparation()
    generation &+= 1
    #if canImport(UIKit)
    transportEpoch &+= 1
    pipRestoreIntent = nil
    fullscreenDismissIntent = nil
    #endif
    try await retireCurrent()
    state = "idle"
    errorCode = nil
    emit()
    return snapshot()
  }

  func beginDelete(_ id: String) async throws {
    guard UUID(uuidString: id) != nil else { throw DropPlaybackError.invalidID }
    reconcileQueuedItem()
    let targets = leases.beginDelete(id)
    if targets.any {
      if targets.prepared {
        cancelPreparation()
        await drainPreparation()
      }
      // AVQueuePlayer can reach a prepared item before its KVO promotion runs.
      // If that item's lease survived cancellation, Delete must retire the
      // transport before Library is allowed to remove the managed file.
      if !targets.current && !leases.retains(id) {
        scheduleNextPreparation()
        return
      }
      contextEpoch &+= 1
      playbackContext = nil
      pendingAutoplayToken = nil
      cancelPreparation()
      await drainPreparation()
      generation &+= 1
      #if canImport(UIKit)
      transportEpoch &+= 1
      pipRestoreIntent = nil
      fullscreenDismissIntent = nil
      #endif
      do { try await retireCurrent() }
      catch { leases.endDelete(id); throw error }
      state = "idle"
      errorCode = nil
      emit()
    }
  }

  func endDelete(_ id: String) { leases.endDelete(id) }

  private func safeCurrentPosition() -> Double {
    guard let duration, let currentOccurrenceItem,
          player.currentItem === currentOccurrenceItem,
          let current = PlaybackPolicy.clamped(CMTimeGetSeconds(player.currentTime()), duration: duration)
    else { return position }
    return current
  }

  private func persist(expected: PlaybackOccurrence? = nil) async throws {
    guard dirty, let id = activeID, let repository,
          let occurrence = currentOccurrence, occurrence.libraryID == id,
          expected == nil || expected == occurrence else { return }
    let saved = position
    let completed = completedAt
    let snapshot = PlaybackProgressWrite(occurrence: occurrence,
      position: saved, completedAt: completed)
    guard let write = progressWrites.enqueue(snapshot, repository: repository) else { return }
    try await write.value
    if currentOccurrence == occurrence && position == saved && completedAt == completed {
      dirty = false
    }
  }

  private func updateNowPlaying() {
    guard activeID != nil else { return }
    system.update(position: safeCurrentPosition(), rate: state == "playing" ? rate : 0)
    lastNowPlayingUpdate = Date()
  }

  func handleSystemEvent(token: UInt64, event: PlaybackSystemEvent) async {
    reconcileQueuedItem()
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
      #if canImport(UIKit)
      transportEpoch &+= 1
      pipRestoreIntent = nil
      fullscreenDismissIntent = nil
      #endif
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
      #if canImport(UIKit)
      transportEpoch &+= 1
      pipRestoreIntent = nil
      fullscreenDismissIntent = nil
      #endif
      wasPlayingBeforeInterruption = false
      if state == "playing" || state == "interrupted" { _ = try? await pause() }
    case .newDeviceAvailable:
      break // Connecting an output never starts playback.
    }
  }

  private func retireCurrent() async throws {
    reconcileQueuedItem()
    cancelPreparation()
    await drainPreparation()
    #if canImport(UIKit)
    let stopReason: DropPiPStopReason = leases.isDeleting(activeID ?? "")
      ? .delete : pendingPiPStopReason
    try await pip.stop(reason: stopReason)
    pendingPiPStopReason = .replacement
    _ = await exitFullscreen()
    pip.reset()
    #endif
    let id = activeID
    let occurrence = currentOccurrence
    let finalPosition = safeCurrentPosition()
    clearItemObservers()
    player.pause()
    player.removeAllItems()
    // If an exceptional stale handoff could not be adopted before teardown,
    // keep its lease until AVQueuePlayer has released the item, then clear it.
    if let strandedPrepared = leases.prepared {
      leases.releasePrepared(strandedPrepared)
    }
    preparedNext = nil
    system.clear()
    completionScheduled = false
    wasPlayingBeforeInterruption = false
    position = finalPosition
    if id != nil { dirty = dirty || state == "playing" || state == "paused" }
    let priorSave = pendingSave
    let finalWrite: Task<Void, Error>?
    if dirty, let occurrence, let repository {
      let snapshot = PlaybackProgressWrite(occurrence: occurrence,
        position: position, completedAt: completedAt)
      finalWrite = progressWrites.enqueue(snapshot, repository: repository,
        after: priorSave)
    } else {
      finalWrite = nil
    }
    if let priorSave { await priorSave.value }
    if currentOccurrence == occurrence { pendingSave = nil }
    // Completion and final progress are both queued before the lease is freed.
    if let id { await progressWrites.drain(id) }
    defer {
      if let occurrence {
        progressWrites.retire(occurrence)
        leases.releaseCurrent(occurrence)
      }
      if currentOccurrence == occurrence {
        activeID = nil
        activeMediaType = nil
        currentOccurrence = nil
        currentOccurrenceItem = nil
        position = 0
        duration = nil
        completedAt = nil
        dirty = false
      }
    }
    if let finalWrite { try await finalWrite.value }
  }

  private func failCurrent(_ error: DropPlaybackError, token: UInt64) async {
    guard token == generation else { return }
    pendingAutoplayToken = nil
    generation &+= 1
    try? await retireCurrent()
    state = "failed"
    errorCode = error.code
    emit()
  }

  private func reconcileQueuedItem() {
    guard let item = player.currentItem, preparedNext?.item === item else { return }
    adoptQueuedItem(item)
  }
}
