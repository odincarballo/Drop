import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Internal values only: no bridge, database, persistent image or provider access.
struct DropLocalMetadata: Sendable {
  var title: String? = nil
  var artist: String? = nil
  var album: String? = nil
  var genre: String? = nil
  var year: Int? = nil
  var jpeg: Data? = nil
  var issues: Set<Issue> = []
  enum Issue: Sendable { case invalidSource, metadataUnavailable, artworkRejected, thumbnailUnavailable, busy }
}

// Roots are supplied by the storage owner, not by JS or the file provider. Call only
// after media validation; duration is reused rather than decoding the media again.
actor DropLocalMetadataExtractor {
  private let roots: [URL]
  private var busy = false
  init(managedRoots: [URL]) { roots = managedRoots.map { $0.standardizedFileURL } }

  func extract(_ url: URL, validatedDuration: Double) async throws -> DropLocalMetadata {
    try Task.checkCancellation()
    guard !busy else { return DropLocalMetadata(issues: [.busy]) }
    guard url.isFileURL, (url.host ?? "").isEmpty,
          ["mp3", "m4a", "mp4"].contains(url.pathExtension.lowercased()),
          validatedDuration.isFinite, validatedDuration > 0,
          roots.contains(where: { url.standardizedFileURL.path.hasPrefix($0.path + "/") }),
          DropLibraryPaths.isUnredirected(url),
          let size = try? DropLibraryFileInspection.regularSize(url), size > 0 else {
      return DropLocalMetadata(issues: [.invalidSource])
    }
    busy = true
    defer { busy = false }
    let asset = AVURLAsset(url: url, options: [
      AVURLAssetReferenceRestrictionsKey: NSNumber(value: AVAssetReferenceRestrictions.forbidAll.rawValue)
    ])
    return try await withTaskCancellationHandler {
      var result = DropLocalMetadata()
      if url.pathExtension.lowercased() == "mp4" {
        do {
          let time = CMTime(seconds: min(1, validatedDuration / 2), preferredTimescale: 600)
          result.jpeg = try await DropThumbnailRequest.image(asset: asset, time: time)
        } catch {
          try Task.checkCancellation()
          result.issues.insert(.thumbnailUnavailable)
        }
      } else {
        // Only known local key spaces; never follow a metadata URL to fetch artwork.
        do {
          let formats = try await asset.load(.availableMetadataFormats)
          for format in [AVMetadataFormat.id3Metadata, .iTunesMetadata] where formats.contains(format) {
            do { try await read(try await asset.loadMetadata(for: format), into: &result) }
            catch { try Task.checkCancellation(); result.issues.insert(.metadataUnavailable) }
          }
        } catch { try Task.checkCancellation(); result.issues.insert(.metadataUnavailable) }
        do { try await read(try await asset.load(.commonMetadata), into: &result) }
        catch { try Task.checkCancellation(); result.issues.insert(.metadataUnavailable) }
      }
      try Task.checkCancellation()
      return result
    } onCancel: {
      // Thumbnail cancellation has its own request; cancelling asset loading first
      // must not interfere with the image generator's completion path.
      if url.pathExtension.lowercased() != "mp4" { asset.cancelLoading() }
    }
  }

  private func read(_ items: [AVMetadataItem], into result: inout DropLocalMetadata) async throws {
    for item in items.prefix(128) {
      try Task.checkCancellation()
      guard let id = item.identifier else { continue }
      do {
        switch id {
        case .id3MetadataTitleDescription, .iTunesMetadataSongName, .commonIdentifierTitle:
          if result.title == nil { result.title = Self.text(try await item.load(.stringValue)) }
        case .id3MetadataLeadPerformer, .iTunesMetadataArtist, .commonIdentifierArtist:
          if result.artist == nil { result.artist = Self.text(try await item.load(.stringValue)) }
        case .id3MetadataAlbumTitle, .iTunesMetadataAlbum, .commonIdentifierAlbumName:
          if result.album == nil { result.album = Self.text(try await item.load(.stringValue)) }
        case .id3MetadataContentType, .iTunesMetadataUserGenre:
          if result.genre == nil, let text = Self.text(try await item.load(.stringValue)),
             text.rangeOfCharacter(from: .letters) != nil { result.genre = text }
        case .id3MetadataYear, .id3MetadataRecordingTime, .iTunesMetadataReleaseDate:
          if result.year == nil { result.year = Self.year(try await item.load(.stringValue)) }
        case .id3MetadataAttachedPicture, .iTunesMetadataCoverArt, .commonIdentifierArtwork:
          if result.jpeg == nil, let data = try await item.load(.dataValue) {
            try Task.checkCancellation()
            result.jpeg = Self.normalizedJPEG(data)
            if result.jpeg == nil { result.issues.insert(.artworkRejected) }
          }
        default: break
        }
      } catch { try Task.checkCancellation(); result.issues.insert(.metadataUnavailable) }
    }
  }

  nonisolated static func text(_ raw: String?) -> String? {
    guard let raw else { return nil }
    let clean = raw.components(separatedBy: .controlCharacters).joined(separator: " ")
      .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    guard !clean.isEmpty else { return nil }
    return String(clean.prefix(240))
  }

  nonisolated static func year(_ raw: String?) -> Int? {
    guard let raw = text(raw), let year = Int(raw.prefix(4)), year > 0, year <= 9999,
          raw.prefix(4).allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
    if raw.count == 4 { return year }
    guard raw.count >= 10 else { return nil }
    let date = String(raw.prefix(10))
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let parsed = formatter.date(from: date), formatter.string(from: parsed) == date else { return nil }
    if raw.count > 10 {
      guard ISO8601DateFormatter().date(from: raw) != nil else { return nil }
    }
    return year
  }

  // AVFoundation may allocate the tag Data before this bound can be checked.
  // Bounds below limit image decoding/output, not AVFoundation's internal memory.
  nonisolated static func normalizedJPEG(_ data: Data) -> Data? {
    guard !data.isEmpty, data.count <= 2 * 1_048_576,
          let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) > 0,
          let p = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int,
          w > 0, h > 0, w <= 4096, h <= 4096, w * h <= 16_000_000,
          CGImageSourceGetStatus(source) == .statusComplete,
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 512,
            kCGImageSourceCreateThumbnailWithTransform: true
          ] as CFDictionary) else { return nil }
    return jpeg(image)
  }

  nonisolated static func jpeg(_ image: CGImage) -> Data? {
    guard image.width > 0, image.height > 0, image.width <= 512, image.height <= 512 else { return nil }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
    guard CGImageDestinationFinalize(dest), data.length <= 2 * 1_048_576 else { return nil }
    return data as Data
  }
}
