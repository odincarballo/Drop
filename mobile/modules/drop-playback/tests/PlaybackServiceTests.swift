import AVFoundation
import CoreVideo
import Foundation

// Standalone macOS test double; the shipping build imports DropLibrary instead.
final class DropLibraryStorage {
  let root: URL
  init(root: URL) { self.root = root }
  convenience init() throws { throw PlaybackRepositoryError.unavailable }

  func managedMedia(relative: String) throws -> (URL, Int64)? {
    let parts = relative.split(separator: "/")
    guard parts.count == 2, parts[0] == "Media",
          let id = parts[1].split(separator: ".").first,
          UUID(uuidString: String(id)) != nil else { return nil }
    let url = root.appendingPathComponent(relative)
    let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values?.isRegularFile == true else { return nil }
    return (url, Int64(values?.fileSize ?? 0))
  }

  func managedArtwork(id: String) throws -> (URL, Int64)? {
    let url = root.appendingPathComponent("Artwork/\(id).jpg")
    let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values?.isRegularFile == true else { return nil }
    return (url, Int64(values?.fileSize ?? 0))
  }
}

@MainActor
final class FakePlaybackSystemBridge: PlaybackSystemBridge {
  var activations = 0
  var clears = 0
  var activeHandlers = 0
  var metadata: [(UInt64, String, URL?, Double, Double, Double)] = []
  var updates: [(Double, Double)] = []
  var failActivation = false
  private var handler: (@MainActor (UInt64, PlaybackSystemEvent) async -> Void)?
  var token: UInt64 { metadata.last!.0 }

  func activate() throws {
    activations += 1
    if failActivation { throw PlaybackRepositoryError.unavailable }
  }
  func setItem(token: UInt64, title: String, artworkURL: URL?, duration: Double,
               position: Double, rate: Double,
               onEvent: @escaping @MainActor (UInt64, PlaybackSystemEvent) async -> Void) {
    metadata.append((token, title, artworkURL, duration, position, rate))
    handler = onEvent
    activeHandlers = 1
  }
  func update(position: Double, rate: Double) { updates.append((position, rate)) }
  func clear() { clears += 1; handler = nil; activeHandlers = 0 }
  func send(_ event: PlaybackSystemEvent) async { await handler?(token, event) }
}

final class FakeProgressRepository: PlaybackProgressRepository {
  var records = [String: PlaybackRecord]()
  var writes = [(String, Double, String?)]()
  var saveError: Error?
  var pauseSaveID: String?
  var resumeSave: CheckedContinuation<Void, Never>?
  var pauseNextLoad = false
  var pauseLoadID: String?
  var resumeLoad: CheckedContinuation<Void, Never>?

  func load(id: String) async throws -> PlaybackRecord {
    if pauseNextLoad || pauseLoadID == id {
      pauseNextLoad = false
      pauseLoadID = nil
      await withCheckedContinuation { resumeLoad = $0 }
    }
    guard let record = records[id] else { throw PlaybackRepositoryError.invalidRecord }
    return record
  }

  func save(id: String, position: Double, completedAt: String?) async throws {
    if pauseSaveID == id {
      pauseSaveID = nil
      await withCheckedContinuation { resumeSave = $0 }
    }
    if let saveError { throw saveError }
    writes.append((id, position, completedAt))
  }
}

@main
@MainActor
struct PlaybackServiceTests {
  static func main() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("DropPlaybackServiceTests-\(UUID().uuidString)")
    let media = root.appendingPathComponent("Media", isDirectory: true)
    try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
    let artwork = root.appendingPathComponent("Artwork", isDirectory: true)
    try FileManager.default.createDirectory(at: artwork, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let first = "00000000-0000-0000-0000-000000000001"
    let second = "00000000-0000-0000-0000-000000000002"
    let third = "00000000-0000-0000-0000-000000000003"
    let fourth = "00000000-0000-0000-0000-000000000004"
    let fifth = "00000000-0000-0000-0000-000000000005"
    let audioOne = media.appendingPathComponent("\(first).m4a")
    try Data([0xFF, 0xD8, 0xFF, 0xD9]).write(to:
      artwork.appendingPathComponent("\(first).jpg"))
    let audioTwo = media.appendingPathComponent("\(second).m4a")
    try createAudio(at: audioOne)
    try FileManager.default.copyItem(at: audioOne, to: audioTwo)
    let video = media.appendingPathComponent("\(third).mp4")
    try await createVideo(at: video)
    let size = Int64(try audioOne.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
    let videoSize = Int64(try video.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
    let repository = FakeProgressRepository()
    repository.records[first] = PlaybackRecord(id: first, relativeMediaPath: "Media/\(first).m4a",
      mediaType: "audio", sizeBytes: size, position: 0.4, completedAt: nil,
      title: "Podcast Uno", relativeArtworkPath: "Artwork/\(first).jpg")
    repository.records[second] = PlaybackRecord(id: second, relativeMediaPath: "Media/\(second).m4a",
      mediaType: "audio", sizeBytes: size, position: 0.7, completedAt: "finished",
      title: "Podcast Dos")
    repository.records[third] = PlaybackRecord(id: third, relativeMediaPath: "Media/\(third).mp4",
      mediaType: "video", sizeBytes: videoSize, position: 0, completedAt: nil)
    repository.records[fourth] = PlaybackRecord(id: fourth,
      relativeMediaPath: "Media/\(fourth).mp4", mediaType: "video",
      sizeBytes: 4, position: 0, completedAt: nil)
    let corrupt = media.appendingPathComponent("\(fifth).mp4")
    try Data([0, 1, 2, 3]).write(to: corrupt)
    repository.records[fifth] = PlaybackRecord(id: fifth,
      relativeMediaPath: "Media/\(fifth).mp4", mediaType: "video",
      sizeBytes: 4, position: 0, completedAt: nil)
    let system = FakePlaybackSystemBridge()
    let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, system: system)
    let onePlayer = ObjectIdentifier(service.player)

    _ = try await service.open(id: first)
    try check(service.isRetaining(first))
    try await ready(service)
    try check(service.snapshot()["status"] as? String == "ready")
    try check(system.activations == 0)
    try check(system.metadata.last?.1 == "Podcast Uno")
    try check(system.metadata.last?.2?.lastPathComponent == "\(first).jpg")
    try check(system.metadata.last?.3 ?? 0 > 0)
    try check(system.metadata.last?.5 == 0)
    try check(abs((service.snapshot()["position"] as? Double ?? 0) - 0.4) < 0.05)
    _ = try await service.seek(-20)
    try check(service.snapshot()["position"] as? Double == 0)
    _ = try await service.skip(15)
    try check((service.snapshot()["position"] as? Double ?? 0) > 0)
    try check((service.snapshot()["position"] as? Double ?? 0) <=
      (service.snapshot()["duration"] as? Double ?? 0))
    try check(service.snapshot()["completed"] as? Bool == false)
    _ = try await service.skip(-15)
    try check(service.snapshot()["position"] as? Double == 0)
    _ = try service.setRate(1.75)
    try check(service.snapshot()["rate"] as? Double == 1.75)
    try check(service.player.rate == 0)
    do { _ = try service.setRate(3); fatalError("invalid rate") }
    catch DropPlaybackError.invalidRate {}
    _ = try await service.pause()
    try check(repository.writes.last?.0 == first)
    try check(service.snapshot()["rate"] as? Double == 1.75)
    try check(service.player.rate == 0)
    _ = try await service.play()
    try check(service.snapshot()["rate"] as? Double == 1.75)
    try check(system.activations == 1)
    try check(system.updates.last?.1 == 1.75)
    let firstItem = service.player.currentItem
    let clearsBeforeLeave = system.clears
    let writesBeforeLeave = repository.writes.count
    _ = try await service.leavePlayerScreen(first)
    try check(service.snapshot()["status"] as? String == "playing")
    try check(service.snapshot()["rate"] as? Double == 1.75)
    try check(service.player.currentItem === firstItem)
    try check(service.isRetaining(first) && system.clears == clearsBeforeLeave)
    try check(repository.writes.count > writesBeforeLeave)
    _ = try await service.leavePlayerScreen(second) // A stale route cannot retire this item.
    try check(service.player.currentItem === firstItem && service.isRetaining(first))
    await system.send(.pause)
    try check(service.snapshot()["status"] as? String == "paused")
    try check(system.updates.last?.1 == 0)
    _ = try await service.leavePlayerScreen(first)
    try check(service.snapshot()["status"] as? String == "paused")
    try check(service.player.currentItem === firstItem && service.isRetaining(first))
    try check(system.clears == clearsBeforeLeave)
    await system.send(.play)
    try check(service.snapshot()["status"] as? String == "playing")
    try check(service.snapshot()["rate"] as? Double == 1.75)
    await system.send(.interruptionBegan)
    try check(service.snapshot()["status"] as? String == "interrupted")
    try check(repository.writes.last?.0 == first)
    await system.send(.interruptionEnded(shouldResume: true))
    try check(service.snapshot()["status"] as? String == "playing")
    await system.send(.oldDeviceUnavailable)
    try check(service.snapshot()["status"] as? String == "paused")
    await system.send(.newDeviceAvailable)
    try check(service.snapshot()["status"] as? String == "paused")
    await system.send(.seek(0))
    await system.send(.play)
    await system.send(.interruptionBegan)
    _ = try await service.pause()
    await system.send(.interruptionEnded(shouldResume: true))
    try check(service.snapshot()["status"] as? String == "paused")
    await system.send(.seek(0))
    await system.send(.play)
    await system.send(.interruptionBegan)
    await system.send(.interruptionEnded(shouldResume: false))
    try check(service.snapshot()["status"] as? String == "paused")
    await system.send(.interruptionBegan)
    await system.send(.interruptionEnded(shouldResume: true))
    try check(service.snapshot()["status"] as? String == "paused")
    await system.send(.skip(15))
    await system.send(.skip(-15))
    await system.send(.seek(0.3))
    try check(abs((service.snapshot()["position"] as? Double ?? 0) - 0.3) < 0.1)
    _ = try await service.pause()

    _ = try await service.open(id: second)
    try check(system.metadata.last?.1 == "Podcast Dos")
    try check(system.metadata.last?.2 == nil)
    let oldToken = system.metadata[0].0
    try check(system.token != oldToken)
    await service.handleSystemEvent(token: oldToken, event: .play)
    await service.handleSystemEvent(token: oldToken, event: .interruptionBegan)
    try check(service.snapshot()["status"] as? String == "loading")
    try check(!service.isRetaining(first) && service.isRetaining(second))
    try check(repository.writes.contains(where: { $0.0 == first }))
    try await ready(service)
    try check(service.snapshot()["position"] as? Double == 0)
    try check(service.snapshot()["completed"] as? Bool == true)
    _ = try await service.play()
    try check(service.snapshot()["completed"] as? Bool == false)
    _ = try await service.pause()
    try check(repository.writes.last?.2 == nil)

    try await service.beginDelete(second)
    try check(system.clears > 0)
    try check(!service.isRetaining(second))
    try check(service.snapshot()["status"] as? String == "idle")
    do { _ = try await service.open(id: second); fatalError("deleting item opened") }
    catch DropPlaybackError.unavailable {}
    service.endDelete(second)

    _ = try await service.close()
    _ = try await service.close()
    try check(service.snapshot()["status"] as? String == "idle")

    _ = try await service.open(id: third)
    try await ready(service)
    try check(ObjectIdentifier(service.player) == onePlayer)
    try check(service.isRetaining(third))
    try check(service.snapshot()["status"] as? String == "ready")
    _ = try await service.play()
    let videoItem = service.player.currentItem
    _ = try await service.leavePlayerScreen(third)
    try check(service.snapshot()["status"] as? String == "playing")
    try check(service.player.currentItem === videoItem && service.isRetaining(third))
    _ = try await service.close()
    try check(!service.isRetaining(third))
    try check(service.player.currentItem == nil)

    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
      sizeBytes: size, position: 0, completedAt: nil)
    _ = try await service.open(id: first)
    try await ready(service)
    _ = try await service.play()
    for _ in 0..<150 {
      if service.snapshot()["status"] as? String == "ended" { break }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    try check(service.snapshot()["status"] as? String == "ended")
    try check(service.snapshot()["completed"] as? Bool == true)
    _ = try await service.close()
    try check(repository.writes.last?.2 != nil)

    do { _ = try await service.open(id: fourth); fatalError("missing file opened") }
    catch DropPlaybackError.unavailable {}
    try check(!service.isRetaining(fourth))
    do { _ = try await service.open(id: fifth); fatalError("corrupt file opened") }
    catch {}
    try check(!service.isRetaining(fifth))
    try check(service.snapshot()["status"] as? String == "failed")

    let missingRecord = repository.records.removeValue(forKey: second)
    do { _ = try await service.open(id: second); fatalError("non-ready row opened") }
    catch PlaybackRepositoryError.invalidRecord {}
    try check(!service.isRetaining(second))
    repository.records[second] = missingRecord

    repository.pauseNextLoad = true
    let openingForDeletion = Task { try? await service.open(id: second) }
    for _ in 0..<100 {
      if repository.resumeLoad != nil { break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    try check(service.isRetaining(second))
    try await service.beginDelete(second)
    repository.resumeLoad?.resume()
    repository.resumeLoad = nil
    _ = await openingForDeletion.value
    try check(!service.isRetaining(second))
    try check(service.player.currentItem == nil)
    service.endDelete(second)

    // Concurrent opens may finish in either order, but only the winning item
    // may hold a lease or publish a later ready callback.
    let openingA = Task { try? await service.open(id: first) }
    let openingB = Task { try? await service.open(id: third) }
    _ = await openingA.value
    _ = await openingB.value
    try await Task.sleep(nanoseconds: 100_000_000)
    let winner = service.snapshot()["libraryId"] as? String
    try check(winner == first || winner == third)
    try check(service.isRetaining(first) != service.isRetaining(third))
    _ = try await service.close()

    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
      sizeBytes: size + 1, position: 0, completedAt: nil)
    do { _ = try await service.open(id: first); fatalError("changed file opened") }
    catch DropPlaybackError.unavailable {}
    try check(!service.isRetaining(first))

    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/\(first).mp3", mediaType: "audio",
      sizeBytes: size, position: 0, completedAt: nil)
    do { _ = try await service.open(id: first); fatalError("MP3 opened") }
    catch DropPlaybackError.unsupported {}
    try check(!service.isRetaining(first))

    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/../\(first).m4a", mediaType: "audio",
      sizeBytes: size, position: 0, completedAt: nil)
    do { _ = try await service.open(id: first); fatalError("traversal opened") }
    catch DropPlaybackError.unavailable {}
    try check(!service.isRetaining(first))

    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
      sizeBytes: size, position: 0, completedAt: nil)
    let failingSystem = FakePlaybackSystemBridge()
    failingSystem.failActivation = true
    let failingService = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, system: failingSystem)
    _ = try await failingService.open(id: first)
    try await ready(failingService)
    do { _ = try await failingService.play(); fatalError("audio session failure ignored") }
    catch DropPlaybackError.audioSession {}
    try check(failingService.snapshot()["status"] as? String == "failed")
    try check(!failingService.isRetaining(first))

    try await contextualQueueTests(root: root, repository: repository,
      first: first, second: second, third: third, fourth: fourth, fifth: fifth,
      size: size, videoSize: videoSize)
    print("PlaybackServiceTests: passed")
  }

  private static func contextualQueueTests(root: URL, repository: FakeProgressRepository,
    first: String, second: String, third: String, fourth: String, fifth: String,
    size: Int64, videoSize: Int64) async throws {
    // No JS subscriber or PlayerScreen participates in native queue advancement.
    let system = FakePlaybackSystemBridge()
    let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, system: system)
    let queuePlayer: AVPlayer = service.player
    try check(queuePlayer === service.player)
    try check(service.player.actionAtItemEnd == .advance)
    let playerIdentity = ObjectIdentifier(service.player)
    _ = try await service.startInContext(id: first,
      orderedIds: [first, fourth, fifth, second])
    try await playing(service, id: first)
    try await prepared(service, id: second) // Missing and corrupt rows were skipped.
    let firstItem = service.player.currentItem
    let nextItem = service.player.items()[1]
    try check(service.isRetaining(first) && service.isRetaining(second))
    try check(abs(CMTimeGetSeconds(nextItem.currentTime())) < 0.05) // completed -> zero
    _ = try service.setRate(1.5)
    _ = try await service.leavePlayerScreen(first)
    try check(service.player.currentItem === firstItem)
    let activations = system.activations
    let clears = system.clears
    repository.pauseSaveID = first
    try await naturalEnd(service)
    try await playing(service, id: second)
    try check(service.player.currentItem === nextItem)
    try check(ObjectIdentifier(service.player) == playerIdentity)
    try check(system.activations == activations && system.clears == clears)
    try check(system.activeHandlers == 1)
    try check(!service.isRetaining(first) && service.isRetaining(second))
    try check(service.snapshot()["rate"] as? Double == 1.5)
    try await effectiveRate(service, expected: 1.5)
    try check(system.metadata.last?.1 == "Podcast Dos")
    for _ in 0..<100 {
      if repository.resumeSave != nil { break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    try check(repository.resumeSave != nil) // B already plays while A's SQLite save waits.
    repository.resumeSave?.resume()
    repository.resumeSave = nil
    for _ in 0..<100 {
      if repository.writes.contains(where: { $0.0 == first && $0.2 != nil }) { break }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    try check(repository.writes.contains(where: { $0.0 == first && $0.2 != nil }))
    try await naturalEnd(service)
    try await ended(service) // Last item has no loop or synthetic successor.
    _ = try await service.close()
    try check(!service.isRetaining(second) && service.player.items().isEmpty)

    // The next item is sought before insertion, so the first audible sample
    // after native advancement is from its persisted position.
    repository.records[first] = PlaybackRecord(id: first,
      relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
      sizeBytes: size, position: 0.4, completedAt: nil, title: "Podcast Uno")
    _ = try await service.startInContext(id: third, orderedIds: [third, first, second])
    try await playing(service, id: third)
    try await prepared(service, id: first)
    try check(abs(CMTimeGetSeconds(service.player.items()[1].currentTime()) - 0.4) < 0.1)
    // Let AVFoundation reach the video end itself; no test or service call
    // advances the queue for this audio/video boundary.
    try await playing(service, id: first)
    try await effectiveRate(service, expected: 1.5)
    try check(abs((service.snapshot()["position"] as? Double ?? 0) - 0.4) < 0.2)
    try await prepared(service, id: second) // B became current; C was queued.
    _ = try await service.close()

    // Delete of PREPARED NEXT removes it before returning to Library and then
    // searches forward. Current audio, lease and Now Playing remain intact.
    _ = try await service.startInContext(id: first, orderedIds: [first, second, third])
    try await playing(service, id: first)
    try await prepared(service, id: second)
    try await service.beginDelete(second)
    try check(!service.isRetaining(second) && service.isRetaining(first))
    try await prepared(service, id: third)
    try await naturalEnd(service)
    try await playing(service, id: third)
    service.endDelete(second)
    try await service.beginDelete(third)
    try check(service.player.currentItem == nil && !service.isRetaining(third))
    service.endDelete(third)
    _ = try await service.close()

    // A manual tap replaces both queue slots and the old context atomically.
    _ = try await service.startInContext(id: first, orderedIds: [first, second])
    try await playing(service, id: first)
    try await prepared(service, id: second)
    let staleItem = service.player.currentItem
    _ = try await service.startInContext(id: third, orderedIds: [third])
    try await playing(service, id: third)
    try check(!service.isRetaining(first) && !service.isRetaining(second))
    try check(service.isRetaining(third) && service.player.items().count == 1)
    NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification,
      object: staleItem)
    try check(service.snapshot()["libraryId"] as? String == third)
    _ = try await service.close()
    try check(system.activeHandlers == 0 && service.player.items().isEmpty)

    // Deleting CURRENT tears down both items and both leases before Library's
    // physical deletion proceeds.
    _ = try await service.startInContext(id: first, orderedIds: [first, second])
    try await playing(service, id: first)
    try await prepared(service, id: second)
    try await service.beginDelete(first)
    try check(!service.isRetaining(first) && !service.isRetaining(second))
    try check(service.player.items().isEmpty && system.activeHandlers == 0)
    service.endDelete(first)
    _ = try await service.close()

    // All four media-type boundaries use the same transport and queue slot.
    let copiedVideo = root.appendingPathComponent("Media/\(fourth).mp4")
    try FileManager.default.copyItem(at:
      root.appendingPathComponent("Media/\(third).mp4"), to: copiedVideo)
    repository.records[fourth] = PlaybackRecord(id: fourth,
      relativeMediaPath: "Media/\(fourth).mp4", mediaType: "video",
      sizeBytes: videoSize, position: 0, completedAt: nil)
    _ = try await service.startInContext(id: third, orderedIds: [third, fourth])
    try await playing(service, id: third)
    try await prepared(service, id: fourth)
    try await naturalEnd(service)
    try await playing(service, id: fourth)
    _ = try await service.close()

    // An in-flight load is cancelled/drained before replacement releases its
    // lease. The stale result cannot insert into the new queue.
    repository.pauseLoadID = second
    _ = try await service.startInContext(id: first, orderedIds: [first, second])
    try await playing(service, id: first)
    for _ in 0..<100 {
      if repository.resumeLoad != nil { break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    try check(repository.resumeLoad != nil && service.isRetaining(second))
    let replacement = Task {
      try await service.startInContext(id: third, orderedIds: [third])
    }
    repository.resumeLoad?.resume()
    repository.resumeLoad = nil
    _ = try await replacement.value
    try await playing(service, id: third)
    try check(!service.isRetaining(second) && service.player.items().count == 1)
    _ = try await service.close()
  }

  private static func prepared(_ service: DropPlaybackService, id: String) async throws {
    for _ in 0..<250 {
      let items = service.player.items()
      if items.count == 2, service.isRetaining(id) { return }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    fatalError("Successor was not prequeued before current ended")
  }

  private static func effectiveRate(_ service: DropPlaybackService,
    expected: Double) async throws {
    for _ in 0..<100 {
      if abs(Double(service.player.rate) - expected) < 0.01 { return }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    fatalError("Selected playback rate was not carried into queued item")
  }

  private static func playing(_ service: DropPlaybackService, id: String) async throws {
    for _ in 0..<150 {
      let snapshot = service.snapshot()
      if snapshot["libraryId"] as? String == id,
         snapshot["status"] as? String == "playing" { return }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    fatalError("Context item did not start playing")
  }

  private static func ended(_ service: DropPlaybackService) async throws {
    for _ in 0..<150 {
      if service.snapshot()["status"] as? String == "ended" { return }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    fatalError("Context did not end")
  }

  private static func naturalEnd(_ service: DropPlaybackService) async throws {
    guard let item = service.player.currentItem else { fatalError("No current item") }
    if service.player.items().count > 1 { service.player.advanceToNextItem() }
    NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification,
      object: item)
    try await Task.sleep(nanoseconds: 20_000_000)
  }

  private static func ready(_ service: DropPlaybackService) async throws {
    for _ in 0..<100 {
      if service.snapshot()["status"] as? String == "ready" { return }
      if service.snapshot()["status"] as? String == "failed" { break }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    fatalError("AVPlayerItem did not become ready")
  }

  private static func createAudio(at url: URL) throws {
    let wav = url.deletingPathExtension().appendingPathExtension("wav")
    let samples = 44_100
    var data = Data()
    func append<T: FixedWidthInteger>(_ value: T) {
      var little = value.littleEndian
      withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }
    data.append(contentsOf: Array("RIFF".utf8))
    append(UInt32(36 + samples * 2))
    data.append(contentsOf: Array("WAVEfmt ".utf8))
    append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
    append(UInt32(44_100)); append(UInt32(88_200))
    append(UInt16(2)); append(UInt16(16))
    data.append(contentsOf: Array("data".utf8))
    append(UInt32(samples * 2))
    data.append(Data(count: samples * 2))
    try data.write(to: wav)
    defer { try? FileManager.default.removeItem(at: wav) }
    let convert = Process()
    convert.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
    convert.arguments = ["-f", "m4af", "-d", "aac", wav.path, url.path]
    try convert.run()
    convert.waitUntilExit()
    guard convert.terminationStatus == 0 else { fatalError("afconvert failed") }
  }

  private static func createVideo(at url: URL) async throws {
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
    guard writer.startWriting() else { throw PlaybackRepositoryError.unavailable }
    writer.startSession(atSourceTime: .zero)
    var pixel: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault, 64, 64,
      kCVPixelFormatType_32ARGB, nil, &pixel) == kCVReturnSuccess,
      let pixel else { throw PlaybackRepositoryError.unavailable }
    CVPixelBufferLockBaseAddress(pixel, [])
    if let memory = CVPixelBufferGetBaseAddress(pixel) {
      memset(memory, 0, CVPixelBufferGetDataSize(pixel))
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    for second in [0, 1] {
      while !input.isReadyForMoreMediaData {
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      guard adaptor.append(pixel,
        withPresentationTime: CMTime(seconds: Double(second), preferredTimescale: 600)) else {
        throw PlaybackRepositoryError.unavailable
      }
    }
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw PlaybackRepositoryError.unavailable }
  }

  private static func check(_ value: @autoclosure () -> Bool,
                            file: StaticString = #fileID, line: UInt = #line) throws {
    if !value() { fatalError("PlaybackServiceTests failed at \(file):\(line)") }
  }
}
