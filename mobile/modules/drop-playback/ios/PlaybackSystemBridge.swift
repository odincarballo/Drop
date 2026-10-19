import Foundation

enum PlaybackSystemEvent {
  case play
  case pause
  case skip(Double)
  case seek(Double)
  case interruptionBegan
  case interruptionEnded(shouldResume: Bool)
  case oldDeviceUnavailable
  case newDeviceAvailable
}

@MainActor
protocol PlaybackSystemBridge: AnyObject {
  func activate() throws
  func setItem(token: UInt64, title: String, artworkURL: URL?, duration: Double,
               position: Double, rate: Double,
               onEvent: @escaping @MainActor (UInt64, PlaybackSystemEvent) async -> Void)
  func update(position: Double, rate: Double)
  // Retire per-item handlers without ending the audio session or Now Playing.
  func suspendItemForHandoff()
  func clear()
}

#if os(iOS)
import AVFAudio
import ImageIO
import MediaPlayer
import UIKit

@MainActor
final class IOSPlaybackSystemBridge: PlaybackSystemBridge {
  private var active = false
  private var receivingRemoteEvents = false
  private var token: UInt64?
  private var onEvent: (@MainActor (UInt64, PlaybackSystemEvent) async -> Void)?
  private var commandTargets: [(MPRemoteCommand, Any)] = []
  private var notifications: [NSObjectProtocol] = []
  private var info: [String: Any] = [:]

  func activate() throws {
    guard !active else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default)
    try session.setActive(true)
    active = true
  }

  func setItem(token: UInt64, title: String, artworkURL: URL?, duration: Double,
               position: Double, rate: Double,
               onEvent: @escaping @MainActor (UInt64, PlaybackSystemEvent) async -> Void) {
    removeItemHandlers()
    self.token = token
    self.onEvent = onEvent
    info = [MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: rate]
    if !receivingRemoteEvents {
      UIApplication.shared.beginReceivingRemoteControlEvents()
      receivingRemoteEvents = true
    }
    installCommands(token: token)
    installNotifications(token: token)
    setArtwork(fallbackArtwork())
    if let artworkURL { loadArtwork(at: artworkURL, token: token) }
  }

  func suspendItemForHandoff() {
    removeItemHandlers()
    // Keep the active session and current Now Playing record until its replacement
    // is installed atomically. The old commands cannot target a retired item.
  }

  func update(position: Double, rate: Double) {
    guard token != nil else { return }
    if position.isFinite { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, position) }
    info[MPNowPlayingInfoPropertyPlaybackRate] = rate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  func clear() {
    removeItemHandlers()
    info.removeAll()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    if receivingRemoteEvents {
      UIApplication.shared.endReceivingRemoteControlEvents()
      receivingRemoteEvents = false
    }
    if active {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      active = false
    }
  }

  private func removeItemHandlers() {
    token = nil
    onEvent = nil
    for (command, target) in commandTargets { command.removeTarget(target) }
    commandTargets.removeAll()
    for observer in notifications { NotificationCenter.default.removeObserver(observer) }
    notifications.removeAll()
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.isEnabled = false
    commands.pauseCommand.isEnabled = false
    commands.skipBackwardCommand.isEnabled = false
    commands.skipForwardCommand.isEnabled = false
    commands.changePlaybackPositionCommand.isEnabled = false
    commands.nextTrackCommand.isEnabled = false
    commands.previousTrackCommand.isEnabled = false
    commands.changeShuffleModeCommand.isEnabled = false
    commands.changeRepeatModeCommand.isEnabled = false
  }

  private func add(_ command: MPRemoteCommand, token: UInt64,
                   event: @escaping (MPRemoteCommandEvent) -> PlaybackSystemEvent?) {
    command.isEnabled = true
    let target = command.addTarget { [weak self] remoteEvent in
      Task { @MainActor [weak self] in
        guard let self, self.token == token, let action = event(remoteEvent),
              let onEvent = self.onEvent else { return }
        await onEvent(token, action)
      }
      return .success
    }
    commandTargets.append((command, target))
  }

  private func installCommands(token: UInt64) {
    let commands = MPRemoteCommandCenter.shared()
    add(commands.playCommand, token: token) { _ in .play }
    add(commands.pauseCommand, token: token) { _ in .pause }
    commands.skipBackwardCommand.preferredIntervals = [15]
    commands.skipForwardCommand.preferredIntervals = [15]
    add(commands.skipBackwardCommand, token: token) { _ in .skip(-15) }
    add(commands.skipForwardCommand, token: token) { _ in .skip(15) }
    add(commands.changePlaybackPositionCommand, token: token) { event in
      guard let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime,
            position.isFinite else { return nil }
      return .seek(position)
    }
    commands.nextTrackCommand.isEnabled = false
    commands.previousTrackCommand.isEnabled = false
    commands.changeShuffleModeCommand.isEnabled = false
    commands.changeRepeatModeCommand.isEnabled = false
  }

  private func installNotifications(token: UInt64) {
    let center = NotificationCenter.default
    notifications.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(), queue: nil) { [weak self] notification in
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      let options = AVAudioSession.InterruptionOptions(rawValue:
        notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
      let event: PlaybackSystemEvent = raw == AVAudioSession.InterruptionType.began.rawValue
        ? .interruptionBegan : .interruptionEnded(shouldResume: options.contains(.shouldResume))
      Task { @MainActor [weak self] in
        guard let self, self.token == token else { return }
        if case .interruptionBegan = event { self.active = false }
        await self.onEvent?(token, event)
      }
    })
    notifications.append(center.addObserver(forName: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance(), queue: nil) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
      let event: PlaybackSystemEvent
      switch reason {
      case .oldDeviceUnavailable: event = .oldDeviceUnavailable
      case .newDeviceAvailable: event = .newDeviceAvailable
      default: return
      }
      Task { @MainActor [weak self] in
        guard let self, self.token == token else { return }
        await self.onEvent?(token, event)
      }
    })
  }

  private func fallbackArtwork() -> UIImage {
    UIImage(named: "AppIcon") ?? UIImage(systemName: "play.rectangle.fill") ?? UIImage()
  }

  private func setArtwork(_ image: UIImage) {
    info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func loadArtwork(at url: URL, token: UInt64) {
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey,
                                                      .fileSizeKey])
      guard url.isFileURL, values?.isRegularFile == true,
            values?.isSymbolicLink != true,
            let size = values?.fileSize, size > 0, size <= 2 * 1_048_576,
            let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceThumbnailMaxPixelSize: 512,
              kCGImageSourceCreateThumbnailWithTransform: true
            ] as CFDictionary) else { return }
      Task { @MainActor [weak self] in
        guard let self, self.token == token else { return }
        self.setArtwork(UIImage(cgImage: image))
      }
    }
  }
}
#else
@MainActor
final class IOSPlaybackSystemBridge: PlaybackSystemBridge {
  func activate() throws {}
  func setItem(token: UInt64, title: String, artworkURL: URL?, duration: Double,
               position: Double, rate: Double,
               onEvent: @escaping @MainActor (UInt64, PlaybackSystemEvent) async -> Void) {}
  func update(position: Double, rate: Double) {}
  func suspendItemForHandoff() {}
  func clear() {}
}
#endif
