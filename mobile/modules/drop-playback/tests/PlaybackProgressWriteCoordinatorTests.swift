import Foundation

private struct RecordedWrite: Equatable, Sendable {
  let id: String
  let position: Double
  let completedAt: String?
}

private actor ControlledProgressRepository: PlaybackProgressRepository {
  private var arrivals: [RecordedWrite] = []
  private var committed: [RecordedWrite] = []
  private var held: Set<Int>
  private var failures: Set<Int>
  private var released: Set<Int> = []
  private var blocked: [Int: CheckedContinuation<Void, Never>] = [:]
  private var arrivalWaiters: [(Int, CheckedContinuation<Void, Never>)] = []

  init(held: Set<Int> = [], failures: Set<Int> = []) {
    self.held = held
    self.failures = failures
  }

  func load(id: String) async throws -> PlaybackRecord {
    throw PlaybackRepositoryError.unavailable
  }

  func save(id: String, position: Double, completedAt: String?) async throws {
    let index = arrivals.count
    arrivals.append(RecordedWrite(id: id, position: position, completedAt: completedAt))
    let ready = arrivalWaiters.filter { $0.0 <= arrivals.count }
    arrivalWaiters.removeAll { $0.0 <= arrivals.count }
    ready.forEach { $0.1.resume() }
    if held.contains(index) && !released.contains(index) {
      await withCheckedContinuation { blocked[index] = $0 }
    }
    if failures.contains(index) { throw PlaybackRepositoryError.busy }
    committed.append(arrivals[index])
  }

  func waitForArrivals(_ count: Int) async {
    if arrivals.count >= count { return }
    await withCheckedContinuation { arrivalWaiters.append((count, $0)) }
  }

  func release(_ index: Int) {
    released.insert(index)
    blocked.removeValue(forKey: index)?.resume()
  }

  func arrivalsSnapshot() -> [RecordedWrite] { arrivals }
  func committedSnapshot() -> [RecordedWrite] { committed }
}

private actor ManualGate {
  private var continuation: CheckedContinuation<Void, Never>?
  private var open = false

  func wait() async {
    if open { return }
    await withCheckedContinuation { continuation = $0 }
  }

  func release() {
    open = true
    continuation?.resume()
    continuation = nil
  }
}

@main
@MainActor
enum PlaybackProgressWriteCoordinatorTests {
  static func main() async throws {
    try await sameLibraryHandoff()
    try await prerequisiteAndIndependentIDs()
    try await failedOldWriteRecovers()
    try await pauseCloseAndDelete()
    print("PlaybackProgressWriteCoordinatorTests: passed")
  }

  private static func sameLibraryHandoff() async throws {
    let id = "00000000-0000-0000-0000-000000000001"
    let repository = ControlledProgressRepository(held: [0])
    let writes = PlaybackProgressWriteCoordinator()
    let first = PlaybackOccurrence(libraryID: id, source: .direct)
    let second = PlaybackOccurrence(libraryID: id, source: .manual(entryID: "repeat"))
    try check(first.identity != second.identity)
    writes.activate(first)
    // Merely preparing NEXT never writes its progress.
    try check(writes.enqueue(PlaybackProgressWrite(occurrence: second,
      position: 0, completedAt: nil), repository: repository) == nil)
    let periodic = try required(writes.enqueue(PlaybackProgressWrite(occurrence: first,
      position: 0.8, completedAt: nil), repository: repository))
    await repository.waitForArrivals(1)
    let priorSave = Task<Void, Never> { _ = try? await periodic.value }
    let completion = try required(writes.enqueue(PlaybackProgressWrite(occurrence: first,
      position: 1, completedAt: "ended-A1"), repository: repository,
      after: priorSave))
    writes.retire(first)
    writes.activate(second)
    try check(writes.enqueue(PlaybackProgressWrite(occurrence: first,
      position: 0.9, completedAt: "stale"), repository: repository) == nil)
    let reset = try required(writes.enqueue(PlaybackProgressWrite(occurrence: second,
      position: 0, completedAt: nil), repository: repository))
    let advanced = try required(writes.enqueue(PlaybackProgressWrite(occurrence: second,
      position: 0.45, completedAt: nil), repository: repository))
    try check(await repository.arrivalsSnapshot().count == 1)
    await repository.release(0)
    await writes.drain(id)
    try await periodic.value
    try await completion.value
    try await reset.value
    try await advanced.value
    let expected = [
      RecordedWrite(id: id, position: 0.8, completedAt: nil),
      RecordedWrite(id: id, position: 1, completedAt: "ended-A1"),
      RecordedWrite(id: id, position: 0, completedAt: nil),
      RecordedWrite(id: id, position: 0.45, completedAt: nil)
    ]
    try check(await repository.arrivalsSnapshot() == expected)
    try check(await repository.committedSnapshot() == expected)
    try check(await repository.committedSnapshot().last?.completedAt == nil)
  }

  private static func prerequisiteAndIndependentIDs() async throws {
    let a = PlaybackOccurrence(libraryID: "A", source: .direct)
    let b = PlaybackOccurrence(libraryID: "B", source: .direct)
    let repository = ControlledProgressRepository()
    let writes = PlaybackProgressWriteCoordinator()
    let gate = ManualGate()
    writes.activate(a)
    writes.activate(b)
    let pendingSave = Task<Void, Never> { await gate.wait() }
    let completed = try required(writes.enqueue(PlaybackProgressWrite(occurrence: a,
      position: 1, completedAt: "ended-A"), repository: repository,
      after: pendingSave))
    let next = try required(writes.enqueue(PlaybackProgressWrite(occurrence: b,
      position: 0.2, completedAt: nil), repository: repository))
    await repository.waitForArrivals(1)
    try check(await repository.arrivalsSnapshot() == [
      RecordedWrite(id: "B", position: 0.2, completedAt: nil)
    ]) // A's pending save does not block a different Library ID.
    await gate.release()
    await writes.drain("A")
    try await completed.value
    try await next.value
    try check(await repository.committedSnapshot().count == 2)
  }

  private static func failedOldWriteRecovers() async throws {
    let id = "A"
    let repository = ControlledProgressRepository(held: [0], failures: [0])
    let writes = PlaybackProgressWriteCoordinator()
    let first = PlaybackOccurrence(libraryID: id, source: .direct)
    let second = PlaybackOccurrence(libraryID: id, source: .manual(entryID: "again"))
    writes.activate(first)
    let failed = try required(writes.enqueue(PlaybackProgressWrite(occurrence: first,
      position: 1, completedAt: "ended-A1"), repository: repository))
    await repository.waitForArrivals(1)
    writes.retire(first)
    writes.activate(second)
    let recovered = try required(writes.enqueue(PlaybackProgressWrite(occurrence: second,
      position: 0.25, completedAt: nil), repository: repository))
    await repository.release(0)
    await writes.drain(id)
    do { try await failed.value; throw PlaybackRepositoryError.invalidRecord }
    catch PlaybackRepositoryError.busy {}
    try await recovered.value
    try check(await repository.committedSnapshot() == [
      RecordedWrite(id: id, position: 0.25, completedAt: nil)
    ])
  }

  private static func pauseCloseAndDelete() async throws {
    let id = "A"
    let repository = ControlledProgressRepository(held: [0])
    let writes = PlaybackProgressWriteCoordinator()
    let occurrence = PlaybackOccurrence(libraryID: id, source: .direct)
    writes.activate(occurrence)
    let pause = try required(writes.enqueue(PlaybackProgressWrite(occurrence: occurrence,
      position: 0.3, completedAt: nil), repository: repository))
    await repository.waitForArrivals(1)
    let resume = try required(writes.enqueue(PlaybackProgressWrite(occurrence: occurrence,
      position: 0.5, completedAt: nil), repository: repository))
    let close = try required(writes.enqueue(PlaybackProgressWrite(occurrence: occurrence,
      position: 0.6, completedAt: nil), repository: repository))
    writes.retire(occurrence) // Delete/close rejects late callbacks, not accepted writes.
    try check(writes.enqueue(PlaybackProgressWrite(occurrence: occurrence,
      position: 0.1, completedAt: nil), repository: repository) == nil)
    await repository.release(0)
    await writes.drain(id)
    try await pause.value
    try await resume.value
    try await close.value
    try check(await repository.committedSnapshot() == [
      RecordedWrite(id: id, position: 0.3, completedAt: nil),
      RecordedWrite(id: id, position: 0.5, completedAt: nil),
      RecordedWrite(id: id, position: 0.6, completedAt: nil)
    ])
  }

  private static func required(_ task: Task<Void, Error>?) throws -> Task<Void, Error> {
    guard let task else { throw PlaybackRepositoryError.invalidRecord }
    return task
  }

  private static func check(_ condition: Bool) throws {
    if !condition { throw PlaybackRepositoryError.invalidRecord }
  }
}
