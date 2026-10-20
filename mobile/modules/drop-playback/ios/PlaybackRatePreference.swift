import Foundation
import CoreFoundation

@MainActor
protocol PlaybackRatePreference {
  func load() -> Double?
  func save(_ rate: Double)
}

@MainActor
final class UserDefaultsPlaybackRatePreference: PlaybackRatePreference {
  private let defaults: UserDefaults
  private let key = "drop.playback.selectedRate"

  init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  func load() -> Double? {
    guard let number = defaults.object(forKey: key) as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return number.doubleValue
  }

  func save(_ rate: Double) {
    guard PlaybackPolicy.rates.contains(rate) else { return }
    defaults.set(rate, forKey: key)
  }
}
