import Foundation

enum PlaybackPolicy {
  static let rates: Set<Double> = [0.75, 1, 1.25, 1.5, 1.75, 2]

  static func supported(extension ext: String, mediaType: String) -> Bool {
    (ext == "mp4" && mediaType == "video") ||
      (ext == "m4a" && mediaType == "audio")
  }

  static func validDuration(_ duration: Double) -> Bool {
    duration.isFinite && duration > 0
  }

  static func clamped(_ position: Double, duration: Double) -> Double? {
    guard position.isFinite, validDuration(duration) else { return nil }
    return min(max(0, position), duration)
  }

  static func completed(position: Double, duration: Double) -> Bool {
    guard let position = clamped(position, duration: duration) else { return false }
    return position >= duration - min(30, duration * 0.05)
  }

  static func restored(position: Double, duration: Double, wasCompleted: Bool) -> Double {
    if wasCompleted { return 0 }
    return clamped(position, duration: duration) ?? 0
  }

  static func shouldPersist(elapsed: TimeInterval, hasProgress: Bool) -> Bool {
    hasProgress && elapsed.isFinite && elapsed >= 12
  }
}
