import Foundation

// A write captures one occurrence and its values before any asynchronous work.
// SQLite serializes execution, but only this chain preserves logical enqueue
// order when two occurrences share the same Library row.
struct PlaybackProgressWrite: Sendable {
  let occurrence: PlaybackOccurrence
  let position: Double
  let completedAt: String?
}

@MainActor
final class PlaybackProgressWriteCoordinator {
  private struct Tail {
    let token: UUID
    let task: Task<Void, Never>
  }

  private var activeOccurrences: [String: UUID] = [:]
  private var tails: [String: Tail] = [:]

  func activate(_ occurrence: PlaybackOccurrence) {
    activeOccurrences[occurrence.libraryID] = occurrence.identity
  }

  func retire(_ occurrence: PlaybackOccurrence) {
    if activeOccurrences[occurrence.libraryID] == occurrence.identity {
      activeOccurrences.removeValue(forKey: occurrence.libraryID)
    }
  }

  // A stale callback cannot enqueue after a newer occurrence becomes active.
  // Already-enqueued writes remain valid and finish before later writes.
  func enqueue(_ write: PlaybackProgressWrite, repository: PlaybackProgressRepository,
               after prerequisite: Task<Void, Never>? = nil) -> Task<Void, Error>? {
    let id = write.occurrence.libraryID
    guard activeOccurrences[id] == write.occurrence.identity else { return nil }
    let previous = tails[id]?.task
    let operation = Task<Void, Error> {
      if let prerequisite { await prerequisite.value }
      if let previous { await previous.value }
      try await repository.save(id: id, position: write.position,
        completedAt: write.completedAt)
    }
    let tail = Task<Void, Never> { _ = try? await operation.value }
    let token = UUID()
    tails[id] = Tail(token: token, task: tail)
    Task { @MainActor [weak self] in
      await tail.value
      if self?.tails[id]?.token == token { self?.tails.removeValue(forKey: id) }
    }
    return operation
  }

  func drain(_ id: String) async {
    while let tail = tails[id] {
      await tail.task.value
      if tails[id]?.token == tail.token { return }
    }
  }
}
