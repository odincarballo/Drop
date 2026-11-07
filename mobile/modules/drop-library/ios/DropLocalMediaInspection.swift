import AudioToolbox
import AVFoundation
import Foundation

enum DropLocalMediaInspection {
  static func inspect(_ url: URL) async throws -> (mediaType: String, durationSeconds: Double) {
    let ext = url.pathExtension.lowercased()
    let folder = DropLibraryPaths.MediaFolder.imported
    guard url.isFileURL, folder.accepts(ext) else { throw DropLibraryStorageError.invalidSource }
    if ext != "mp3" { try checkMP4Container(url) }

    let asset = AVURLAsset(url: url, options: [
      AVURLAssetReferenceRestrictionsKey: NSNumber(value: AVAssetReferenceRestrictions.forbidAll.rawValue)
    ])
    let (playable, protected, duration, tracks) = try await asset.load(
      .isPlayable, .hasProtectedContent, .duration, .tracks)
    let seconds = duration.seconds
    let mediaType: AVMediaType = ext == "mp4" ? .video : .audio
    guard playable, !protected, seconds.isFinite, seconds > 0,
          let track = tracks.first(where: { $0.mediaType == mediaType }),
          mediaType == .video || !tracks.contains(where: { $0.mediaType == .video }) else {
      throw DropLibraryStorageError.invalidSource
    }
    if mediaType == .audio {
      let expectedFormat = ext == "mp3" ? kAudioFormatMPEGLayer3 : kAudioFormatMPEG4AAC
      let descriptions = try await track.load(.formatDescriptions)
      guard descriptions.contains(where: {
        CMFormatDescriptionGetMediaSubType($0) == expectedFormat
      }) else { throw DropLibraryStorageError.invalidSource }
    }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    guard reader.canAdd(output) else { throw DropLibraryStorageError.invalidSource }
    reader.add(output)
    defer { reader.cancelReading() }
    guard reader.startReading(), output.copyNextSampleBuffer() != nil else {
      throw DropLibraryStorageError.invalidSource
    }
    return (mediaType == .video ? "video" : "audio", seconds)
  }

  // Validate top-level box boundaries without reading or decoding the entire file.
  private static func checkMP4Container(_ url: URL) throws {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    let end = try file.seekToEnd()
    var offset: UInt64 = 0
    var hasFileType = false
    var hasMedia = false
    while offset < end {
      try Task.checkCancellation()
      try file.seek(toOffset: offset)
      guard let header = try file.read(upToCount: 8), header.count == 8 else {
        throw DropLibraryStorageError.invalidSource
      }
      let length = header.prefix(4).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
      let type = String(decoding: header.suffix(4), as: UTF8.self)
      let size: UInt64
      var headerSize: UInt64 = 8
      switch length {
      case 0: size = end - offset
      case 1:
        guard let large = try file.read(upToCount: 8), large.count == 8 else {
          throw DropLibraryStorageError.invalidSource
        }
        headerSize = 16
        size = large.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
      default: size = length
      }
      guard size >= headerSize, size <= end - offset else { throw DropLibraryStorageError.invalidSource }
      if type == "ftyp" && size >= headerSize + 8 { hasFileType = true }
      if type == "mdat" && size > headerSize { hasMedia = true }
      offset += size
    }
    guard hasFileType, hasMedia else { throw DropLibraryStorageError.invalidSource }
  }
}
