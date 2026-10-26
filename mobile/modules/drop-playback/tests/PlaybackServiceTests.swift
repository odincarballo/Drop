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

final class FakeProgressRepository: PlaybackProgressRepository, @unchecked Sendable {
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

private actor FakeManualQueueRepository: PlaybackManualQueueRepository {
  private var entries: [PlaybackManualQueueEntry] = []
  private var consumed: [String] = []
  private var readFailure: PlaybackManualQueueError?
  private var consumeFailure: PlaybackManualQueueError?
  private var holdConsume = false
  private var consumeContinuation: CheckedContinuation<Void, Never>?
  private var holdRead = false
  private var readContinuation: CheckedContinuation<Void, Never>?

  func pendingEntries() async throws -> [PlaybackManualQueueEntry] {
    if let readFailure { throw readFailure }
    let snapshot = entries
    if holdRead {
      holdRead = false
      await withCheckedContinuation { readContinuation = $0 }
    }
    return snapshot
  }

  func consume(entryID: String, itemID: String) async throws -> PlaybackManualQueueConsumeResult {
    if holdConsume {
      holdConsume = false
      await withCheckedContinuation { consumeContinuation = $0 }
    }
    if let consumeFailure { throw consumeFailure }
    guard let index = entries.firstIndex(where: { $0.entryID == entryID }) else {
      return .missing
    }
    guard entries[index].itemID == itemID else { return .itemMismatch }
    entries.remove(at: index)
    consumed.append(entryID)
    return .persisted
  }

  func replace(_ values: [PlaybackManualQueueEntry]) { entries = values }
  func failReads(_ error: PlaybackManualQueueError?) { readFailure = error }
  func failConsume(_ error: PlaybackManualQueueError?) { consumeFailure = error }
  func consumedIDs() -> [String] { consumed }
  func holdNextConsume() { holdConsume = true }
  func holdNextRead() { holdRead = true }
  func isReadWaiting() -> Bool { readContinuation != nil }
  func releaseRead() { readContinuation?.resume(); readContinuation = nil }
  func isConsumeWaiting() -> Bool { consumeContinuation != nil }
  func releaseConsume() {
    consumeContinuation?.resume()
    consumeContinuation = nil
  }
}

@MainActor
final class FakePlaybackRatePreference: PlaybackRatePreference {
  var stored: Double?
  var writes: [Double] = []

  init(_ stored: Double? = nil) { self.stored = stored }
  func load() -> Double? { stored }
  func save(_ rate: Double) { stored = rate; writes.append(rate) }
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
    let ratePreference = FakePlaybackRatePreference()
    let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, manualQueue: FakeManualQueueRepository(),
      system: system, ratePreference: ratePreference)
    let onePlayer = ObjectIdentifier(service.player)
    try check(service.snapshot()["rate"] as? Double == 1)
    try check(service.player.defaultRate == 1)
    for invalid in [Double.nan, .infinity, 0, 3] {
      let invalidPreference = FakePlaybackRatePreference(invalid)
      let invalidService = DropPlaybackService(ratePreference: invalidPreference)
      try check(invalidService.snapshot()["rate"] as? Double == 1)
      try check(invalidService.player.defaultRate == 1)
      try check(invalidPreference.writes.isEmpty)
    }
    let defaultsSuite = "DropPlaybackRateTests.\(UUID().uuidString)"
    guard let defaults = UserDefaults(suiteName: defaultsSuite) else {
      fatalError("Cannot create isolated UserDefaults suite")
    }
    defer { defaults.removePersistentDomain(forName: defaultsSuite) }
    let storedPreference = UserDefaultsPlaybackRatePreference(defaults: defaults)
    try check(storedPreference.load() == nil)
    storedPreference.save(1.5)
    try check(UserDefaultsPlaybackRatePreference(defaults: defaults).load() == 1.5)
    storedPreference.save(3)
    try check(storedPreference.load() == 1.5)
    defaults.set(true, forKey: "drop.playback.selectedRate")
    try check(storedPreference.load() == nil)
    defaults.set("invalid", forKey: "drop.playback.selectedRate")
    try check(storedPreference.load() == nil)

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
    try check(ratePreference.stored == 1.75 && ratePreference.writes == [1.75])
    let relaunched = DropPlaybackService(ratePreference: ratePreference)
    try check(relaunched.snapshot()["rate"] as? Double == 1.75)
    try check(relaunched.player.defaultRate == 1.75)
    try check(service.player.rate == 0)
    do { _ = try service.setRate(3); fatalError("invalid rate") }
    catch DropPlaybackError.invalidRate {}
    try check(ratePreference.writes == [1.75])
    _ = try await service.pause()
    try check(ratePreference.writes == [1.75])
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
    try check(service.snapshot()["rate"] as? Double == 1.75)
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
    try check(ratePreference.stored == 1.75)

    try await service.beginDelete(second)
    try check(system.clears > 0)
    try check(!service.isRetaining(second))
    try check(service.snapshot()["status"] as? String == "idle")
    try check(ratePreference.stored == 1.75)
    do { _ = try await service.open(id: second); fatalError("deleting item opened") }
    catch DropPlaybackError.unavailable {}
    service.endDelete(second)

    _ = try await service.close()
    _ = try await service.close()
    try check(service.snapshot()["status"] as? String == "idle")
    try check(ratePreference.stored == 1.75)

    _ = try await service.open(id: third)
    try await ready(service)
    try check(ObjectIdentifier(service.player) == onePlayer)
    try check(service.isRetaining(third))
    try check(service.snapshot()["status"] as? String == "ready")
    try check(service.snapshot()["rate"] as? Double == 1.75)
    try check(service.player.defaultRate == 1.75)
    _ = try await service.play()
    let videoItem = service.player.currentItem
    _ = try await service.leavePlayerScreen(third)
    try check(service.snapshot()["status"] as? String == "playing")
    try check(service.player.currentItem === videoItem && service.isRetaining(third))
    _ = try await service.close()
    try check(!service.isRetaining(third))
    try check(service.player.currentItem == nil)

    // A fresh native service (simulated process relaunch) starts at the stored
    // rate without a transient 1× play call or a JavaScript restoration step.
    let newSession = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, manualQueue: FakeManualQueueRepository(),
      system: FakePlaybackSystemBridge(),
      ratePreference: ratePreference)
    _ = try await newSession.open(id: first)
    try await ready(newSession)
    try check(newSession.player.defaultRate == 1.75)
    _ = try await newSession.play()
    try await effectiveRate(newSession, expected: 1.75)
    _ = try await newSession.close()
    try check(ratePreference.stored == 1.75)

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
    let openingForDeletion = Task { _ = try? await service.open(id: second) }
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
    let openingA = Task { _ = try? await service.open(id: first) }
    let openingB = Task { _ = try? await service.open(id: third) }
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
      repository: repository, manualQueue: FakeManualQueueRepository(), system: failingSystem,
      ratePreference: FakePlaybackRatePreference())
    _ = try await failingService.open(id: first)
    try await ready(failingService)
    do { _ = try await failingService.play(); fatalError("audio session failure ignored") }
    catch DropPlaybackError.audioSession {}
    try check(failingService.snapshot()["status"] as? String == "failed")
    try check(!failingService.isRetaining(first))

    try await contextualQueueTests(root: root, repository: repository,
      first: first, second: second, third: third, fourth: fourth, fifth: fifth,
      size: size, videoSize: videoSize)
    try await manualQueueTests(root: root, first: first, second: second,
      third: third, audioSize: size, videoSize: videoSize)
    try await reconciliationTests(root: root, first: first, second: second,
      third: third, audioSize: size, videoSize: videoSize)
    print("PlaybackServiceTests: passed")
  }

  private static func manualQueueTests(root: URL, first: String, second: String,
    third: String, audioSize: Int64, videoSize: Int64) async throws {
    let entryX = "10000000-0000-0000-0000-000000000001"
    let entryY = "10000000-0000-0000-0000-000000000002"
    func entry(_ id: String, _ item: String, _ position: Int64) -> PlaybackManualQueueEntry {
      PlaybackManualQueueEntry(entryID: id, itemID: item, position: position,
        addedAt: "2026-10-25T00:00:00.000Z", lifecycle: .ready)
    }
    func makeRecords() -> FakeProgressRepository {
      let records = FakeProgressRepository()
      records.records[first] = PlaybackRecord(id: first,
        relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
        sizeBytes: audioSize, position: 0, completedAt: nil, title: "A")
      records.records[second] = PlaybackRecord(id: second,
        relativeMediaPath: "Media/\(second).m4a", mediaType: "audio",
        sizeBytes: audioSize, position: 0.2, completedAt: nil, title: "B")
      records.records[third] = PlaybackRecord(id: third,
        relativeMediaPath: "Media/\(third).mp4", mediaType: "video",
        sizeBytes: videoSize, position: 0, completedAt: nil, title: "C")
      return records
    }
    func makeService(_ records: FakeProgressRepository,
      _ queue: FakeManualQueueRepository) -> DropPlaybackService {
      DropPlaybackService(storage: DropLibraryStorage(root: root), repository: records,
        manualQueue: queue, system: FakePlaybackSystemBridge(),
        ratePreference: FakePlaybackRatePreference())
    }
    func current(_ service: DropPlaybackService, _ item: AVPlayerItem) async throws {
      for _ in 0..<150 {
        if service.player.currentItem === item { return }
        try await Task.sleep(nanoseconds: 20_000_000)
      }
      fatalError("Prepared occurrence did not become CURRENT")
    }
    func consumed(_ queue: FakeManualQueueRepository, _ count: Int) async throws {
      for _ in 0..<150 {
        if await queue.consumedIDs().count == count { return }
        try await Task.sleep(nanoseconds: 20_000_000)
      }
      fatalError("Manual occurrence was not consumed")
    }

    // A -> X -> Y -> B -> C; Y and B share a Library ID but represent
    // independent manual and contextual occurrences.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0), entry(entryY, second, 1)])
      let service = makeService(records, queue)
      let playerID = ObjectIdentifier(service.player)
      _ = try await service.startInContext(id: first,
        orderedIds: [first, second, third])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      let beforeStart = await queue.consumedIDs()
      try check(beforeStart.isEmpty) // Preparation is not consumption.
      let xItem = service.player.items()[1]
      try await naturalEnd(service)
      try await current(service, xItem)
      try await playing(service, id: third)
      try await consumed(queue, 1)
      try await prepared(service, id: second)
      let yItem = service.player.items()[1]
      try await naturalEnd(service)
      try await current(service, yItem)
      try await playing(service, id: second)
      try await consumed(queue, 2)
      try await prepared(service, id: second)
      let bItem = service.player.items()[1]
      try check(bItem !== yItem)
      try await naturalEnd(service)
      try await current(service, bItem)
      try await prepared(service, id: third)
      let cItem = service.player.items()[1]
      try await naturalEnd(service)
      try await current(service, cItem)
      try check(ObjectIdentifier(service.player) == playerID)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder == [entryX, entryY])
      _ = try await service.close()
    }

    // A1 completion must be serialized before a distinct manual A2 begins at
    // zero and clears the completion marker, even with A1's save blocked.
    do {
      let records = makeRecords()
      records.records[first] = PlaybackRecord(id: first,
        relativeMediaPath: "Media/\(first).m4a", mediaType: "audio",
        sizeBytes: audioSize, position: 0.35, completedAt: nil, title: "A")
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, first, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: first)
      let a2 = service.player.items()[1]
      try check(abs(CMTimeGetSeconds(a2.currentTime())) < 0.05)
      _ = try service.setRate(1.5)
      records.pauseSaveID = first
      try await naturalEnd(service)
      try await current(service, a2)
      try await playing(service, id: first)
      try check(service.snapshot()["rate"] as? Double == 1.5)
      try await effectiveRate(service, expected: 1.5)
      try check(service.snapshot()["completed"] as? Bool == false)
      try check((service.snapshot()["position"] as? Double ?? -1) < 0.2)
      for _ in 0..<100 {
        if records.resumeSave != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeSave != nil)
      records.resumeSave?.resume()
      records.resumeSave = nil
      for _ in 0..<100 {
        if records.writes.last?.0 == first && records.writes.last?.2 == nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.writes.contains(where: { $0.0 == first && $0.2 != nil }))
      try check(records.writes.last?.0 == first && records.writes.last?.2 == nil)
      try await consumed(queue, 1)
      _ = try await service.close()
    }

    // A mutation can preempt an already prepared contextual B only after an
    // explicit native reconciliation (B2C will connect that notification).
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first,
        orderedIds: [first, second, third])
      try await playing(service, id: first)
      try await prepared(service, id: second)
      let staleB = service.player.items()[1]
      await queue.replace([entry(entryX, third, 0)])
      await service.reconcilePendingQueue()
      try await prepared(service, id: third)
      try check(service.player.items()[1] !== staleB)
      try await naturalEnd(service)
      try await playing(service, id: third)
      try await consumed(queue, 1)
      try await prepared(service, id: second) // B was never skipped.
      _ = try await service.close()
    }

    // No context is required for manual auto-next. An invalid row is retained
    // but skipped once within this playback session.
    do {
      let records = makeRecords()
      let invalid = "00000000-0000-0000-0000-000000000005"
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, invalid, 0), entry(entryY, second, 1)])
      let service = makeService(records, queue)
      _ = try await service.open(id: first)
      try await ready(service)
      _ = try await service.play()
      try await playing(service, id: first) // Explicit play, no JS auto-next.
      try await prepared(service, id: second)
      let beforeStart = await queue.consumedIDs()
      try check(beforeStart.isEmpty)
      try await naturalEnd(service)
      try await playing(service, id: second)
      try await consumed(queue, 1)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder == [entryY])
      _ = try await service.close()
    }

    // An unavailable SQLite priority is not an empty queue. Once the read
    // recovers, native reconciliation may safely prepare contextual B.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.failReads(.busy)
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if service.snapshot()["errorCode"] as? String == "QUEUE_READ_FAILED" { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(service.player.items().count == 1)
      await queue.failReads(nil)
      await service.reconcilePendingQueue()
      try await prepared(service, id: second)
      _ = try await service.close()
    }

    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.failReads(.schemaNotPrepared)
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if service.snapshot()["errorCode"] as? String == "QUEUE_SCHEMA_NOT_READY" { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(service.snapshot()["errorCode"] as? String == "QUEUE_SCHEMA_NOT_READY")
      try check(service.player.items().count == 1)
      _ = try await service.close()
    }

    // A failed durable consume leaves the row present but does not select the
    // same entry again in this session. A later transition retries once.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      await queue.failConsume(.busy)
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      try await naturalEnd(service)
      try await playing(service, id: third)
      for _ in 0..<100 {
        if service.snapshot()["errorCode"] as? String == "QUEUE_CONSUME_FAILED" { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(service.snapshot()["errorCode"] as? String == "QUEUE_CONSUME_FAILED")
      let pending = try await queue.pendingEntries()
      try check(pending.map(\.entryID) == [entryX])
      try await prepared(service, id: second) // No repeated X.
      await queue.failConsume(nil)
      try await naturalEnd(service)
      try await playing(service, id: second)
      try await consumed(queue, 1)
      _ = try await service.close()
    }

    // A durable consume already accepted at CURRENT may finish after close.
    // Its failure preserves the row without publishing errors into idle state.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      await queue.holdNextConsume()
      await queue.failConsume(.busy)
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      try await naturalEnd(service)
      try await playing(service, id: third)
      for _ in 0..<100 {
        if await queue.isConsumeWaiting() { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      let waiting = await queue.isConsumeWaiting()
      try check(waiting)
      _ = try await service.close()
      await queue.releaseConsume()
      try await Task.sleep(nanoseconds: 100_000_000)
      try check(service.snapshot()["status"] as? String == "idle")
      try check(service.snapshot()["errorCode"] is NSNull)
      let pending = try await queue.pendingEntries()
      try check(pending.map(\.entryID) == [entryX])
    }

    // Removing a prepared row cancels only NEXT; CURRENT remains audible and
    // the contextual B is still eligible. A stale end callback is harmless.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      let cancelled = service.player.items()[1]
      await queue.replace([])
      await service.reconcilePendingQueue()
      try await prepared(service, id: second)
      try check(service.player.items()[1] !== cancelled)
      NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification,
        object: cancelled)
      try check(service.snapshot()["libraryId"] as? String == first)
      _ = try await service.close()
    }

    // Delete of an item occupying BOTH slots must remove both AVPlayerItems
    // and both occurrence leases before the managed file can be deleted.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, first, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: first)
      try await service.beginDelete(first)
      try check(service.player.items().isEmpty)
      try check(!service.isRetaining(first))
      let pending = try await queue.pendingEntries()
      try check(pending.map(\.entryID) == [entryX]) // Fake has no Library FK cascade.
      service.endDelete(first)
    }

    // Without the B2C post-commit signal, a row removed after NEXT was
    // prepared may still cross AVKit's boundary. Once CURRENT, it is not
    // rolled back; conditional consume reports missing and does not crash.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      await queue.replace([])
      try await naturalEnd(service)
      try await playing(service, id: third)
      try await prepared(service, id: second)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder.isEmpty)
      _ = try await service.close()
    }

    // Removing the only candidate during an asynchronous load cancels the
    // in-flight NEXT as well; its late result cannot insert a stale item.
    do {
      let records = makeRecords()
      records.pauseLoadID = third
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if records.resumeLoad != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeLoad != nil)
      await queue.replace([])
      let reconciliation = Task { await service.reconcilePendingQueue() }
      await Task.yield()
      records.resumeLoad?.resume()
      records.resumeLoad = nil
      _ = await reconciliation.value
      try check(service.player.items().count == 1)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder.isEmpty)
      _ = try await service.close()
    }

    // A slow native preparation remains eligible when CURRENT reaches its
    // natural end; the successor starts when loading completes, without JS.
    do {
      let records = makeRecords()
      records.pauseLoadID = third
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if records.resumeLoad != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeLoad != nil)
      try await ended(service)
      records.resumeLoad?.resume()
      records.resumeLoad = nil
      try await playing(service, id: third)
      try await consumed(queue, 1)
      _ = try await service.close()
    }

    // Pauses, interruption and output loss while NEXT is loading after the
    // real natural end cannot authorize autoplay. A later explicit play (or
    // permitted interruption resume) continues the native handoff.
    for event in [PlaybackSystemEvent.pause, .oldDeviceUnavailable,
                  .interruptionBegan] {
      let records = makeRecords()
      records.pauseLoadID = third
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let system = FakePlaybackSystemBridge()
      let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
        repository: records, manualQueue: queue, system: system,
        ratePreference: FakePlaybackRatePreference())
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if records.resumeLoad != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeLoad != nil)
      try await ended(service)
      await system.send(event)
      records.resumeLoad?.resume()
      records.resumeLoad = nil
      try await Task.sleep(nanoseconds: 100_000_000)
      let interrupted: Bool
      if case .interruptionBegan = event { interrupted = true } else { interrupted = false }
      try check(service.snapshot()["status"] as? String == (interrupted ? "interrupted" : "paused"))
      if !interrupted { try check(service.snapshot()["playable"] as? Bool == true) }
      try check(service.player.rate == 0)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder.isEmpty)
      await system.send(.newDeviceAvailable)
      try check(service.player.rate == 0)
      if interrupted { await system.send(.interruptionEnded(shouldResume: true)) }
      else { await system.send(.play) }
      try await playing(service, id: third)
      try await consumed(queue, 1)
      _ = try await service.close()
    }

    // A user pause during Siri cancels the pending permission to resume.
    do {
      let records = makeRecords()
      records.pauseLoadID = third
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let system = FakePlaybackSystemBridge()
      let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
        repository: records, manualQueue: queue, system: system,
        ratePreference: FakePlaybackRatePreference())
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if records.resumeLoad != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeLoad != nil)
      try await ended(service)
      await system.send(.interruptionBegan)
      await system.send(.pause)
      await system.send(.interruptionEnded(shouldResume: true))
      records.resumeLoad?.resume()
      records.resumeLoad = nil
      try await Task.sleep(nanoseconds: 100_000_000)
      try check(service.snapshot()["status"] as? String == "paused")
      try check(service.player.rate == 0)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder.isEmpty)
      _ = try await service.close()
    }

    // Distinct duplicate entries advance on real AVFoundation end events,
    // without advanceToNextItem or synthetic notifications in the test.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, first, 0), entry(entryY, first, 1)])
      let service = makeService(records, queue)
      let playerID = ObjectIdentifier(service.player)
      _ = try await service.startInContext(id: first, orderedIds: [first])
      try await playing(service, id: first)
      let a1 = service.player.currentItem!
      try await prepared(service, id: first)
      let a2 = service.player.items()[1]
      try check(a1 !== a2 && service.isRetaining(first))
      try await current(service, a2)
      try await consumed(queue, 1)
      try await prepared(service, id: first)
      let a3 = service.player.items()[1]
      try check(a3 !== a2 && a3 !== a1)
      try await current(service, a3)
      try await consumed(queue, 2)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder == [entryX, entryY])
      try check(ObjectIdentifier(service.player) == playerID)
      _ = try await service.close()
    }

    // Delete wins safely even when manual NEXT crossed CURRENT before KVO.
    // Only Queue removal permits playback to continue; Library Delete retires
    // the actual transport before the managed files could be removed.
    do {
      let records = makeRecords()
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      try await prepared(service, id: third)
      let next = service.player.items()[1]
      service.player.advanceToNextItem()
      try check(service.player.currentItem === next)
      try await service.beginDelete(third)
      try check(service.player.items().isEmpty)
      try check(!service.isRetaining(first) && !service.isRetaining(third))
      try check(FileManager.default.fileExists(atPath: root.appendingPathComponent("Media/\(third).mp4").path))
      NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: next)
      await Task.yield()
      try check(service.player.items().isEmpty)
      service.endDelete(third)
      _ = try await service.close()
    }

    // A manual load blocked in the repository retains its lease until Delete
    // has cancelled and drained it. Late work cannot reinsert the deleted NEXT.
    do {
      let records = makeRecords()
      records.pauseLoadID = third
      let queue = FakeManualQueueRepository()
      await queue.replace([entry(entryX, third, 0)])
      let service = makeService(records, queue)
      _ = try await service.startInContext(id: first, orderedIds: [first, second])
      try await playing(service, id: first)
      for _ in 0..<100 {
        if records.resumeLoad != nil { break }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(records.resumeLoad != nil && service.isRetaining(third))
      var deleted = false
      let deletion = Task {
        try await service.beginDelete(third)
        deleted = true
      }
      try await Task.sleep(nanoseconds: 20_000_000)
      try check(!deleted && service.isRetaining(third))
      records.resumeLoad?.resume()
      records.resumeLoad = nil
      try await deletion.value
      try check(deleted && !service.isRetaining(third) && service.isRetaining(first))
      try await prepared(service, id: second)
      let consumedOrder = await queue.consumedIDs()
      try check(consumedOrder.isEmpty)
      service.endDelete(third)
      _ = try await service.close()
    }
  }

  private static func reconciliationTests(root: URL, first: String, second: String,
    third: String, audioSize: Int64, videoSize: Int64) async throws {
    let x = "20000000-0000-0000-0000-000000000001"
    let y = "20000000-0000-0000-0000-000000000002"
    func entry(_ id: String, _ item: String, _ position: Int64 = 0) -> PlaybackManualQueueEntry {
      PlaybackManualQueueEntry(entryID: id, itemID: item, position: position,
        addedAt: "2026-10-26T00:00:00.000Z", lifecycle: .ready)
    }
    func make() async throws -> (DropPlaybackService, FakeProgressRepository,
      FakeManualQueueRepository, FakePlaybackSystemBridge) {
      let records = FakeProgressRepository()
      for (id, ext, type, size) in [(first, "m4a", "audio", audioSize),
        (second, "m4a", "audio", audioSize), (third, "mp4", "video", videoSize)] {
        records.records[id] = PlaybackRecord(id: id, relativeMediaPath: "Media/\(id).\(ext)",
          mediaType: type, sizeBytes: size, position: 0, completedAt: nil, title: id)
      }
      let queue = FakeManualQueueRepository()
      let system = FakePlaybackSystemBridge()
      let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
        repository: records, manualQueue: queue, system: system,
        ratePreference: FakePlaybackRatePreference())
      _ = try await service.startInContext(id: first, orderedIds: [first, second, third])
      try await playing(service, id: first)
      try await prepared(service, id: second)
      return (service, records, queue, system)
    }
    func loadWaiting(_ records: FakeProgressRepository) async throws {
      for _ in 0..<100 {
        if records.resumeLoad != nil { return }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      fatalError("Reconciliation did not reach held asset load")
    }
    func readWaiting(_ queue: FakeManualQueueRepository) async throws {
      for _ in 0..<100 {
        if await queue.isReadWaiting() { return }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      fatalError("Reconciliation did not reach held SQLite read")
    }

    // ACK waits for the replacement NEXT; reorder, removal and clear preserve
    // CURRENT and the unconsumed contextual cursor, even for NEXT A == CURRENT A.
    do {
      let (service, _, queue, _) = try await make()
      let current = service.player.currentItem
      let playerID = ObjectIdentifier(service.player)
      await queue.replace([entry(x, third), entry(y, first, 1)])
      let inserted = await service.reconcilePendingQueue()
      try check(inserted == .applied)
      try await prepared(service, id: third)
      await queue.replace([entry(y, first), entry(x, third, 1)])
      let reordered = await service.reconcilePendingQueue()
      try check(reordered == .applied)
      try await prepared(service, id: first)
      try check(service.player.currentItem === current && service.isRetaining(first))
      await queue.replace([entry(x, third)])
      let removed = await service.reconcilePendingQueue()
      try check(removed == .applied)
      try await prepared(service, id: third)
      await queue.replace([])
      let cleared = await service.reconcilePendingQueue()
      try check(cleared == .applied)
      try await prepared(service, id: second)
      try check(service.player.currentItem === current && ObjectIdentifier(service.player) == playerID)
      let consumed = await queue.consumedIDs()
      try check(consumed.isEmpty && !service.isRetaining(third))
      _ = try await service.close()
    }

    // AVKit can retain an exhausted CURRENT. A newly committed Queue row
    // must not get an applied ACK when no NEXT was actually prepared.
    do {
      let (service, _, queue, _) = try await make()
      _ = try await service.startInContext(id: first, orderedIds: [first])
      let current = service.player.currentItem
      try await naturalEnd(service)
      try await ended(service)
      _ = try await service.pause()
      try check(service.player.currentItem === current)
      await queue.replace([entry(x, third)])
      let ack = await service.reconcilePendingQueue()
      try check(ack == .superseded)
      try check(service.player.currentItem === current && service.player.rate == 0)
      try check(!service.isRetaining(third))
      let pending = try await queue.pendingEntries()
      try check(pending.map(\.entryID) == [x])
      _ = try await service.close()
    }

    // A delayed older SQLite snapshot cannot override the latest request.
    do {
      let (service, _, queue, _) = try await make()
      await queue.replace([entry(x, third)])
      await queue.holdNextRead()
      let old = Task { await service.reconcilePendingQueue() }
      try await readWaiting(queue)
      await queue.replace([entry(y, first)])
      let latest = await service.reconcilePendingQueue()
      try check(latest == .applied)
      await queue.releaseRead()
      let oldResult = await old.value
      try check(oldResult == .superseded)
      try await prepared(service, id: first)
      _ = try await service.close()
    }

    // Concurrent cancellation drains only its own preparation, never the new
    // one. The late AVPlayerItem cannot be inserted or release CURRENT A.
    do {
      let (service, records, queue, _) = try await make()
      records.pauseLoadID = third
      await queue.replace([entry(x, third)])
      let old = Task { await service.reconcilePendingQueue() }
      try await loadWaiting(records)
      await queue.replace([entry(y, first)])
      let latest = Task { await service.reconcilePendingQueue() }
      await Task.yield()
      records.resumeLoad?.resume(); records.resumeLoad = nil
      let results = await (old.value, latest.value)
      try check(results.0 == .superseded && results.1 == .applied)
      try await prepared(service, id: first)
      try check(!service.isRetaining(third) && service.isRetaining(first))
      _ = try await service.close()
    }

    // Transport commands remain independent of the reconciliation ACK.
    for event in [PlaybackSystemEvent.pause, .interruptionBegan, .oldDeviceUnavailable] {
      let (service, records, queue, system) = try await make()
      let current = service.player.currentItem
      records.pauseLoadID = third
      await queue.replace([entry(x, third)])
      let ack = Task { await service.reconcilePendingQueue() }
      try await loadWaiting(records)
      await system.send(event)
      records.resumeLoad?.resume(); records.resumeLoad = nil
      let result = await ack.value
      try check(result == .applied)
      try check(service.player.rate == 0 && service.player.currentItem === current)
      let consumed = await queue.consumedIDs()
      try check(consumed.isEmpty)
      _ = try await service.close()
    }

    // A native handoff that wins before a SQLite reply stays CURRENT.
    do {
      let (service, _, queue, _) = try await make()
      let next = service.player.items()[1]
      await queue.replace([entry(x, third)])
      await queue.holdNextRead()
      let ack = Task { await service.reconcilePendingQueue() }
      try await readWaiting(queue)
      service.player.advanceToNextItem()
      await queue.releaseRead()
      let result = await ack.value
      try check(result == .superseded)
      try check(service.player.currentItem === next)
      try await playing(service, id: second)
      try await prepared(service, id: third)
      _ = try await service.close()
    }

    // Delete during reconciliation keeps its barrier until the load drains.
    do {
      let (service, records, queue, _) = try await make()
      records.pauseLoadID = third
      await queue.replace([entry(x, third)])
      let ack = Task { await service.reconcilePendingQueue() }
      try await loadWaiting(records)
      let deletion = Task { try await service.beginDelete(third) }
      await Task.yield()
      records.resumeLoad?.resume(); records.resumeLoad = nil
      try await deletion.value
      let result = await ack.value
      try check(result == .superseded)
      try check(!service.isRetaining(third) && service.isRetaining(first))
      service.endDelete(third)
      _ = try await service.close()
    }

    // Replacing CURRENT while a reconciliation read is pending invalidates
    // its generation; its old snapshot cannot reconfigure the new session.
    do {
      let (service, _, queue, _) = try await make()
      await queue.holdNextRead()
      let ack = Task { await service.reconcilePendingQueue() }
      try await readWaiting(queue)
      _ = try await service.startInContext(id: third, orderedIds: [third])
      try await playing(service, id: third)
      let current = service.player.currentItem
      await queue.releaseRead()
      let result = await ack.value
      try check(result == .superseded && service.player.currentItem === current)
      try check(service.snapshot()["libraryId"] as? String == third)
      _ = try await service.close()
    }

    // An error in the replacement preparation is a failed ACK, not applied.
    do {
      let (service, records, queue, _) = try await make()
      records.pauseLoadID = third
      await queue.replace([entry(x, third)])
      let ack = Task { await service.reconcilePendingQueue() }
      try await loadWaiting(records)
      await queue.failReads(.busy)
      records.resumeLoad?.resume(); records.resumeLoad = nil
      let result = await ack.value
      try check(result == .failed && service.player.items().count == 1)
      await queue.failReads(nil)
      _ = try await service.close()
    }

    // A failed consume emits nothing. An explicit reconciliation retries the
    // durable write; repeated ACKs do not duplicate its event.
    do {
      let (service, _, queue, _) = try await make()
      var events = 0
      service.onQueueChanged = { events += 1 }
      await queue.replace([entry(x, third)])
      await queue.failConsume(.busy)
      let applied = await service.reconcilePendingQueue()
      try check(applied == .applied && events == 0)
      try await naturalEnd(service)
      try await playing(service, id: third)
      for _ in 0..<100 {
        if service.snapshot()["errorCode"] as? String == "QUEUE_CONSUME_FAILED" { break }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      try check(service.snapshot()["errorCode"] as? String == "QUEUE_CONSUME_FAILED")
      try check(events == 0)
      await queue.failConsume(nil)
      _ = await service.reconcilePendingQueue()
      for _ in 0..<100 {
        if events == 1 { break }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      try check(events == 1)
      _ = await service.reconcilePendingQueue()
      try check(events == 1)
      _ = try await service.close()
    }

    // Durable consume emits exactly after success, including after close;
    // rollback and retry/missing do not manufacture duplicate events.
    do {
      let (service, _, queue, _) = try await make()
      var events = 0
      service.onQueueChanged = { events += 1 }
      await queue.replace([entry(x, third)])
      await queue.holdNextConsume()
      let applied = await service.reconcilePendingQueue()
      try check(applied == .applied && events == 0)
      try await naturalEnd(service)
      try await playing(service, id: third)
      for _ in 0..<100 {
        if await queue.isConsumeWaiting() { break }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      try check(events == 0)
      _ = try await service.close()
      await queue.releaseConsume()
      for _ in 0..<100 {
        if events == 1 { break }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      try check(events == 1)
      let pending = try await queue.pendingEntries()
      try check(pending.isEmpty)
    }
  }

  private static func contextualQueueTests(root: URL, repository: FakeProgressRepository,
    first: String, second: String, third: String, fourth: String, fifth: String,
    size: Int64, videoSize: Int64) async throws {
    // No JS subscriber or PlayerScreen participates in native queue advancement.
    let system = FakePlaybackSystemBridge()
    let ratePreference = FakePlaybackRatePreference()
    let service = DropPlaybackService(storage: DropLibraryStorage(root: root),
      repository: repository, manualQueue: FakeManualQueueRepository(),
      system: system, ratePreference: ratePreference)
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
    try check(ratePreference.stored == 1.5)
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
    try check(ratePreference.stored == 1.5)
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
    try check(ratePreference.stored == 1.5)

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
    try check(ratePreference.stored == 1.5)
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

    // Delete at the AVQueuePlayer handoff boundary must not release a prepared
    // file while that exact item has already become current ahead of KVO.
    _ = try await service.startInContext(id: first, orderedIds: [first, second])
    try await playing(service, id: first)
    try await prepared(service, id: second)
    let deletingAtHandoff = service.player.items()[1]
    service.player.advanceToNextItem()
    try check(service.player.currentItem === deletingAtHandoff)
    try await service.beginDelete(second)
    try check(service.player.currentItem == nil && service.player.items().isEmpty)
    try check(!service.isRetaining(first) && !service.isRetaining(second))
    service.endDelete(second)

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
    try check(ratePreference.stored == 1.5)

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
      _ = try await service.startInContext(id: third, orderedIds: [third])
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
      if items.count == 2, service.isRetaining(id),
         let asset = items[1].asset as? AVURLAsset,
         asset.url.deletingPathExtension().lastPathComponent == id { return }
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
