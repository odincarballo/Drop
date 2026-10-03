import Foundation

private enum StorageTestFailure: Error { case failed(String) }

private func expectStorageFailure(_ code: String, _ body: () throws -> Void) throws {
  do {
    try body()
    throw StorageTestFailure.failed("Expected \(code)")
  } catch let failure as MDAudioDownloadFailure {
    guard failure.code == code else {
      throw StorageTestFailure.failed("Expected \(code), got \(failure.code)")
    }
  }
}

@main
enum StorageBudgetTests {
  static func main() throws {
    let mib: Int64 = 1024 * 1024
    guard MDDownloadSizePolicy.videoMaximumBytes(height: 360) == 1024 * mib,
          MDDownloadSizePolicy.videoMaximumBytes(height: 364) == 1024 * mib,
          MDDownloadSizePolicy.videoMaximumBytes(height: 720) == 1024 * mib,
          MDDownloadSizePolicy.videoMaximumBytes(height: 1080) == 50 * mib,
          MDDownloadSizePolicy.audioBytes == 250 * mib else {
      throw StorageTestFailure.failed("Generated track limits changed")
    }
    let free: Int64 = 4 * 1024 * mib
    let reserve = MDStorageBudget.reserve(free)
    guard reserve == 1024 * mib,
          MDStorageBudget.plannedBytes(exact: nil, approximate: 100 * mib,
            cap: 250 * mib) == 125 * mib,
          MDStorageBudget.plannedBytes(exact: 90 * mib, approximate: 100 * mib,
            cap: 250 * mib) == 90 * mib,
          MDStorageBudget.plannedBytes(exact: nil, approximate: nil,
            cap: 250 * mib) == 250 * mib else {
      throw StorageTestFailure.failed("Size planning changed")
    }
    for (mode, video, audio) in [
      (MDStorageMode.video, 500 * mib, Int64(0)),
      (.audio, 0, 150 * mib),
      (.combined, 500 * mib, 150 * mib),
      (.combinedAudio, 500 * mib, 150 * mib),
      (.audioNormalization, 0, 150 * mib),
      (.mux, 500 * mib, 150 * mib),
    ] {
      let required = MDStorageBudget.requiredBytes(mode: mode, video: video, audio: audio)
      try MDStorageBudget.validate(mode: mode, video: video, audio: audio,
        available: required + reserve)
      try expectStorageFailure("LOCAL_STORAGE_INSUFFICIENT") {
        try MDStorageBudget.validate(mode: mode, video: video, audio: audio,
          available: required + reserve - 1)
      }
    }
    try expectStorageFailure("LOCAL_STORAGE_CAPACITY_UNAVAILABLE") {
      try MDStorageBudget.validate(mode: .video, video: 500 * mib, available: nil)
    }
    try MDStorageBudget.validate(mode: .video, video: 5 * mib, available: nil)
    try expectStorageFailure("LOCAL_STORAGE_INSUFFICIENT") {
      try MDStorageBudget.validate(mode: .mux, video: 500 * mib,
        audio: 150 * mib, available: 800 * mib)
    }
    print("StorageBudgetTests: passed")
  }
}
