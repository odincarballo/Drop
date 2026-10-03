// Generated from download-size-policy.json. Do not edit manually.
import Foundation

enum MDDownloadSizePolicy {
  static let standardVideoBytes: Int64 = 1024 * 1024 * 1024
  static let phaseOne1080VideoBytes: Int64 = 50 * 1024 * 1024
  static let audioBytes: Int64 = 250 * 1024 * 1024
  static let qualityTolerance = 16
  static let reserveFloorBytes: Int64 = 1024 * 1024 * 1024
  static let reservePercent: Int64 = 10
  static let outputFloorBytes: Int64 = 64 * 1024 * 1024
  static let outputOverheadPercent: Int64 = 10
  static let approximateMarginPercent: Int64 = 25

  static func videoMaximumBytes(height: Int?) -> Int64 {
    guard let height,
          abs(height - 360) <= qualityTolerance || abs(height - 720) <= qualityTolerance
    else { return phaseOne1080VideoBytes }
    return standardVideoBytes
  }
}
