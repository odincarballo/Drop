import Foundation

enum MDStorageMode {
  case video
  case audio
  case combined
  case combinedAudio
  case audioNormalization
  case mux
}

enum MDStorageBudget {
  static let previousVideoLimit: Int64 = 50 * 1024 * 1024
  static let previousAudioLimit: Int64 = 25 * 1024 * 1024

  static func availableCapacity(fileManager: FileManager = .default) -> Int64? {
    guard let cache = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first,
          let values = try? cache.resourceValues(
            forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
          let available = values.volumeAvailableCapacityForImportantUsage,
          available >= 0 else { return nil }
    return available
  }

  // Approximate yt-dlp sizes are not authoritative. Reserve 25% more until a
  // validated HTTP total is available; unknown sizes reserve the track cap.
  static func plannedBytes(exact: Int64?, approximate: Int64?, cap: Int64) -> Int64 {
    if let exact, exact > 0 { return exact }
    if let approximate, approximate > 0 {
      if approximate >= cap { return cap }
      let margin = approximate * MDDownloadSizePolicy.approximateMarginPercent / 100
      return min(cap, approximate + margin)
    }
    return cap
  }

  static func outputAllowance(_ inputBytes: Int64) -> Int64 {
    inputBytes + max(MDDownloadSizePolicy.outputFloorBytes,
      inputBytes * MDDownloadSizePolicy.outputOverheadPercent / 100)
  }

  static func reserve(_ available: Int64) -> Int64 {
    max(MDDownloadSizePolicy.reserveFloorBytes,
      available * MDDownloadSizePolicy.reservePercent / 100)
  }

  static func requiredBytes(mode: MDStorageMode, video: Int64, audio: Int64) -> Int64 {
    switch mode {
    case .video: return video
    case .audio: return audio + outputAllowance(audio)
    case .combined: return video + audio + outputAllowance(video + audio)
    case .combinedAudio: return audio + outputAllowance(video + audio)
    case .audioNormalization: return outputAllowance(audio)
    case .mux: return outputAllowance(video + audio)
    }
  }

  static func validate(
    mode: MDStorageMode,
    video: Int64 = 0,
    audio: Int64 = 0,
    available: Int64? = availableCapacity()
  ) throws {
    guard video >= 0, audio >= 0,
          video <= MDDownloadSizePolicy.standardVideoBytes,
          audio <= MDDownloadSizePolicy.audioBytes else {
      throw MDAudioDownloadFailure.code("LOCAL_STORAGE_INSUFFICIENT")
    }
    guard let available else {
      // Preserve the old small-file path if iOS cannot report capacity, but
      // never assume that a newly enabled large transfer has unlimited space.
      if video > previousVideoLimit || audio > previousAudioLimit {
        throw MDAudioDownloadFailure.code("LOCAL_STORAGE_CAPACITY_UNAVAILABLE")
      }
      return
    }
    let required = requiredBytes(mode: mode, video: video, audio: audio)
    guard available >= required + reserve(available) else {
      throw MDAudioDownloadFailure.code("LOCAL_STORAGE_INSUFFICIENT")
    }
  }
}
