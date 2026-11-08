import AVFoundation
import CryptoKit
import Foundation
import ImageIO

@main
struct DropEnrichedImportTests {
  static func main() async throws {
    let fixtures = URL(fileURLWithPath: CommandLine.arguments[1])
    let root = URL(fileURLWithPath: CommandLine.arguments[2])
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let storage = try DropLibraryStorage(
      supportDirectory: root.appendingPathComponent("Support"),
      cacheDirectory: root.appendingPathComponent("Cache"))
    var failures = 0
    func check(_ ok: Bool, _ label: String) {
      print("\(ok ? "PASS" : "FAIL") \(label)")
      if !ok { failures += 1 }
    }
    // Authorized synthetic AAC fixture, extended with embedded artwork for this integration.
    let m4a = root.appendingPathComponent("covered.m4a")
    let source = AVURLAsset(url: fixtures.appendingPathComponent("tagged.m4a"))
    let export = AVAssetExportSession(asset: source, presetName: AVAssetExportPresetPassthrough)!
    export.outputURL = m4a
    export.outputFileType = .m4a
    var metadata = try await source.load(.metadata)
    let audioExtractor = DropLocalMetadataExtractor(managedRoots: [fixtures])
    let cover = try await audioExtractor.extract(
      fixtures.appendingPathComponent("tagged.mp3"), validatedDuration: 1
    ).jpeg!
    let picture = AVMutableMetadataItem()
    picture.identifier = .iTunesMetadataCoverArt
    picture.value = cover as NSData
    metadata.append(picture)
    export.metadata = metadata
    await export.export()
    guard export.status == .completed else { throw export.error ?? CocoaError(.fileWriteUnknown) }
    for (file, type) in [
      (fixtures.appendingPathComponent("tagged.mp3"), "audio"), (m4a, "audio"),
      (fixtures.appendingPathComponent("horizontal.mp4"), "video"),
      (fixtures.appendingPathComponent("rotated.mp4"), "video"),
      (fixtures.appendingPathComponent("bare.mp3"), "audio"),
      (fixtures.appendingPathComponent("corrupt-art.mp3"), "audio"),
    ] {
      let before = SHA256.hash(data: try Data(contentsOf: file))
      let staged = try await storage.stageLocalFile(from: file, capacity: { _ in 10_000_000_000 })
      let prepared = DropPreparedLocalFile(
        uri: staged.uri, title: staged.title, mediaType: staged.mediaType,
        durationSeconds: staged.durationSeconds)
      let result = try await DropLocalImportOperation.enriched(prepared)
      check(
        result.uri == staged.uri && result.mediaType == type
          && result.durationSeconds == staged.durationSeconds,
        "\(file.lastPathComponent) preserves validated media identity and duration")
      switch file.lastPathComponent {
      case "tagged.mp3":
        check(
          result.title == "Canción 東京" && result.artist == "Artista" && result.album == "Álbum"
            && result.genre == "Jazz" && result.year == 2024 && result.localArtwork != nil,
          "real staged MP3 complete metadata and artwork")
      case "covered.m4a":
        check(
          result.title == "M4A Title" && result.artist == "AAC Artist" && result.album == "Album"
            && result.genre == "Jazz" && result.year == 2023 && result.localArtwork != nil,
          "real staged M4A complete metadata and artwork")
      case "bare.mp3":
        check(
          result.title == "bare" && result.artist == nil && result.year == nil
            && result.localArtwork == nil, "untagged playable medium retains filename")
      case "corrupt-art.mp3":
        check(
          result.title == "Audio válido" && result.localArtwork == nil,
          "corrupt optional artwork preserves medium and confirmed title")
      default:
        if let jpeg = result.localArtwork,
          let image = CGImageSourceCreateWithData(jpeg as CFData, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any],
          let width = props[kCGImagePropertyPixelWidth] as? Int,
          let height = props[kCGImagePropertyPixelHeight] as? Int
        {
          check(
            file.lastPathComponent == "rotated.mp4" ? height > width : width > height,
            "\(file.lastPathComponent) thumbnail orientation and proportions")
        } else {
          check(false, "video has thumbnail")
        }
      }
      let originalHash = SHA256.hash(data: try Data(contentsOf: file))
      let stagedHash = SHA256.hash(data: try Data(contentsOf: URL(string: staged.uri)!))
      check(
        originalHash == before && stagedHash == before,
        "\(file.lastPathComponent) original and staged bytes unchanged")
    }
    print("FAILURES \(failures)")
    if failures > 0 { exit(1) }
  }
}
