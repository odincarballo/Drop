import AVFoundation
import Foundation

@main
enum DropLibraryStorageTests {
  static func main() async throws {
    let manager = FileManager.default
    let sandbox = manager.temporaryDirectory.resolvingSymlinksInPath()
      .appendingPathComponent("drop-storage-\(UUID().uuidString)", isDirectory: true)
    try manager.createDirectory(at: sandbox, withIntermediateDirectories: false)
    defer { try? manager.removeItem(at: sandbox) }
    let support = sandbox.appendingPathComponent("Application Support", isDirectory: true)
    let cache = sandbox.appendingPathComponent("Caches", isDirectory: true)
    let storage = try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)

    let podcast = sandbox.appendingPathComponent("Original title.mp3")
    // 32 MPEG-1 Layer III silence frames, each 417 bytes at 128 kbit/s and 44.1 kHz.
    let frame = Data([0xff, 0xfb, 0x90, 0xc4]) + Data(count: 413)
    let audio = (0..<32).reduce(into: Data()) { buffer, _ in buffer.append(frame) }
    try audio.write(to: podcast)
    let stage = try await storage.stageLocalFile(from: podcast, capacity: plenty)
    try require(stage.title == "Original title" && stage.mediaType == "audio" && stage.durationSeconds > 0,
                "MP3 metadata")
    let source = try storage.inspectSource(uri: stage.uri, origin: "local")
    let aliasedURI = stage.uri.replacingOccurrences(of: "file:///private/var/", with: "file:///var/")
    try require(try storage.inspectSource(uri: aliasedURI, origin: "local").id == source.id, "cache system alias")
    let local = source.relativeMediaPath
    try require(local == "ImportedMedia/\(source.id).mp3" && source.size == audio.count, "MP3 destination")
    try require(try Data(contentsOf: podcast) == audio, "source unchanged")

    try rejects("external URL accepted by the bridge") {
      _ = try storage.inspectSource(uri: podcast.absoluteString, origin: "local")
    }
    try rejects("staged local source accepted as a download") {
      _ = try storage.inspectSource(uri: stage.uri, origin: "direct")
    }
    try rejects("wrong expected destination accepted") {
      _ = try storage.moveFromCache(relative: source.cacheRelativePath, id: source.id, ext: source.ext,
        origin: "local", expectedSize: source.size, expectedPath: "Media/\(source.id).mp3")
    }
    try rejects("partial source accepted") {
      _ = try storage.moveFromCache(relative: source.cacheRelativePath, id: source.id, ext: source.ext,
        origin: "local", expectedSize: source.size + 1, expectedPath: local)
    }

    let destination = storage.root.appendingPathComponent(local)
    let collision = Data(repeating: 7, count: audio.count)
    try collision.write(to: destination)
    try rejects("existing imported file overwritten") {
      _ = try storage.moveFromCache(relative: source.cacheRelativePath, id: source.id, ext: source.ext,
        origin: "local", expectedSize: source.size, expectedPath: local)
    }
    try require(try Data(contentsOf: destination) == collision, "collision retained")
    try require(try storage.preparedSource(relative: source.cacheRelativePath) != nil, "staged copy retained")
    try manager.removeItem(at: destination)
    try manager.createSymbolicLink(at: destination, withDestinationURL: podcast)
    try rejects("managed symlink read") { _ = try storage.managedMedia(relative: local) }
    try rejects("managed symlink removed") { try storage.removeMedia(relative: local) }
    try manager.removeItem(at: destination)

    // Simulate exclusion inherited from moving a formerly excluded staged file.
    var stagedURL = try requireURL(stage.uri)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try stagedURL.setResourceValues(values)
    let moved = try storage.moveFromCache(relative: source.cacheRelativePath, id: source.id, ext: source.ext,
      origin: "local", expectedSize: source.size, expectedPath: local)
    try require(moved.0 == local && moved.2 == audio.count, "move result")
    try require(try Data(contentsOf: moved.1) == audio && Data(contentsOf: podcast) == audio, "copy integrity")
    try await storage.confirmImported(relative: local, id: source.id, size: source.size, mediaType: "audio")
    try require(try excluded(moved.1) == false && excluded(storage.importedMedia) == false, "import backup eligibility")
    try require(try excluded(storage.media) == true && excluded(storage.artwork) == true, "legacy backup exclusions")

    let downloaded = cache.appendingPathComponent("mediadrop-0123456789abcdef0123456789abcdef-clip.mp3")
    try audio.write(to: downloaded)
    for kind in ["youtube", "direct"] {
      let prepared = try storage.inspectSource(uri: downloaded.absoluteString, origin: kind)
      try require(prepared.relativeMediaPath == "Media/\(prepared.id).mp3", "legacy destination")
    }
    let remote = try storage.inspectSource(uri: downloaded.absoluteString, origin: "direct")
    _ = try storage.moveFromCache(relative: remote.cacheRelativePath, id: remote.id, ext: remote.ext,
      origin: "direct", expectedSize: remote.size, expectedPath: remote.relativeMediaPath)
    let other = "ImportedMedia/\(remote.id).mp3"
    try audio.write(to: storage.root.appendingPathComponent(other))
    try require(try Set(storage.mediaFiles()) == Set([remote.relativeMediaPath, local, other]), "dual enumeration")
    try storage.removeMedia(relative: local)
    try require(try storage.managedMedia(relative: remote.relativeMediaPath) != nil, "download retained")
    try require(try storage.managedMedia(relative: other) != nil, "other import retained")
    try storage.removeMedia(relative: remote.relativeMediaPath)
    try require(try storage.managedMedia(relative: other) != nil, "import retained after download delete")

    // Test a real compressed audio file and a valid container with a truncated box.
    let aac = sandbox.appendingPathComponent("Fixture.m4a")
    try writeM4A(aac)
    let aacStage = try await storage.stageLocalFile(from: aac, capacity: plenty)
    let pending = try storage.inspectSource(uri: aacStage.uri, origin: "local")
    try require(aacStage.mediaType == "audio" && pending.ext == "m4a", "M4A preparation")
    let video = sandbox.appendingPathComponent("Fixture.mp4")
    try await writeMP4(video)
    let videoStage = try await storage.stageLocalFile(from: video, capacity: plenty)
    let preparedVideo = try storage.inspectSource(uri: videoStage.uri, origin: "local")
    try require(videoStage.mediaType == "video" && preparedVideo.ext == "mp4", "MP4 preparation")
    let corrupt = sandbox.appendingPathComponent("Truncated.m4a")
    try Data([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]).write(to: corrupt)
    do {
      _ = try await storage.stageLocalFile(from: corrupt, capacity: plenty)
      fatalError("truncated file staged")
    } catch DropLibraryStorageError.invalidSource {}
    do {
      _ = try await storage.stageLocalFile(from: podcast, capacity: { _ in 12 })
      fatalError("file staged without space")
    } catch DropLibraryStorageError.insufficientSpace {}
    do {
      _ = try await storage.stageLocalFile(from: podcast, capacity: { volume in
        FileManager.default.fileExists(atPath: volume.appendingPathComponent("partial.mp3").path)
          ? 12 : 4_000_000_000
      })
      fatalError("file staged after space disappeared")
    } catch DropLibraryStorageError.insufficientSpace {}
    let strayID = UUID().uuidString.lowercased()
    let stray = cache.appendingPathComponent("DropImport/\(strayID)", isDirectory: true)
    try manager.createDirectory(at: stray, withIntermediateDirectories: false)
    try audio.write(to: stray.appendingPathComponent("partial.mp3"))
    try manager.createSymbolicLink(at: stray.appendingPathComponent("payload.mp3"), withDestinationURL: podcast)
    try storage.cleanupImportStaging(protected: [pending.cacheRelativePath])
    try require(!manager.fileExists(atPath: stray.appendingPathComponent("partial.mp3").path), "partial cleaned")
    try require(manager.fileExists(atPath: stray.appendingPathComponent("payload.mp3").path), "unknown symlink preserved")
    try require(try storage.preparedSource(relative: pending.cacheRelativePath) != nil, "pending M4A retained")
    try require(try Data(contentsOf: podcast) == audio, "cleanup preserves source")
    try storage.cleanupImportStaging(protected: [])
    try require(try storage.preparedSource(relative: pending.cacheRelativePath) == nil, "unreferenced staging removed")
    try require(try storage.managedMedia(relative: other) != nil, "orphan import retained")

    let otherSupport = sandbox.appendingPathComponent("Other Support", isDirectory: true)
    let otherRoot = otherSupport.appendingPathComponent("Drop", isDirectory: true)
    try manager.createDirectory(at: otherRoot, withIntermediateDirectories: true)
    try manager.createSymbolicLink(at: otherRoot.appendingPathComponent("ImportedMedia"), withDestinationURL: storage.importedMedia)
    try rejects("import directory symlink accepted") {
      _ = try DropLibraryStorage(supportDirectory: otherSupport, cacheDirectory: cache)
    }

    print("DropLibraryStorageTests: passed (MP3, M4A, MP4, partials, path isolation and backup flags)")
  }

  static func plenty(_ url: URL) -> Int64? { 4_000_000_000 }

  static func requireURL(_ value: String) throws -> URL {
    guard let url = URL(string: value) else { throw DropLibraryStorageError.invalidSource }
    return url
  }

  static func excluded(_ url: URL) throws -> Bool? {
    try URL(fileURLWithPath: url.path).resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
  }

  static func require(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
    if try !condition() { throw NSError(domain: label, code: 1) }
  }

  static func rejects(_ label: String, _ operation: () throws -> Void) throws {
    do { try operation() } catch { return }
    throw NSError(domain: label, code: 1)
  }

  static func writeM4A(_ url: URL) throws {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 22_050) else {
      throw DropLibraryStorageError.invalidSource
    }
    buffer.frameLength = 22_050
    guard let samples = buffer.floatChannelData?.pointee else { throw DropLibraryStorageError.invalidSource }
    for i in 0..<Int(buffer.frameLength) { samples[i] = 0 }
    let file = try AVAudioFile(forWriting: url, settings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1
    ])
    try file.write(from: buffer)
  }

  static func writeMP4(_ url: URL) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: 64,
      AVVideoHeightKey: 64
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: 64,
        kCVPixelBufferHeightKey as String: 64
      ])
    writer.add(input)
    guard writer.startWriting() else { throw DropLibraryStorageError.invalidSource }
    writer.startSession(atSourceTime: .zero)
    var pixel: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault, 64, 64,
      kCVPixelFormatType_32ARGB, nil, &pixel) == kCVReturnSuccess,
      let pixel else { throw DropLibraryStorageError.invalidSource }
    CVPixelBufferLockBaseAddress(pixel, [])
    if let memory = CVPixelBufferGetBaseAddress(pixel) {
      memset(memory, 0, CVPixelBufferGetDataSize(pixel))
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    for second in [0, 1] {
      for _ in 0..<100 where !input.isReadyForMoreMediaData {
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      guard input.isReadyForMoreMediaData else { throw DropLibraryStorageError.invalidSource }
      guard adaptor.append(pixel,
        withPresentationTime: CMTime(seconds: Double(second), preferredTimescale: 600)) else {
        throw DropLibraryStorageError.invalidSource
      }
    }
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw DropLibraryStorageError.invalidSource }
  }
}
