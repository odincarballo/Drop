import Foundation

// A Library ID identifies the managed file, not one play of that file.
// Manual and contextual occurrences remain independent even for the same ID.
enum PlaybackOccurrenceSource: Equatable, Sendable {
  case direct
  case context(index: Int)
  case manual(entryID: String)
}

struct PlaybackOccurrence: Equatable, Sendable {
  let libraryID: String
  let identity: UUID
  let source: PlaybackOccurrenceSource

  // Each instance is one preparation/playback attempt; never reuse it for a
  // later slot, even when the Library ID and manual entry ID are unchanged.
  init(libraryID: String, source: PlaybackOccurrenceSource) {
    self.libraryID = libraryID
    self.source = source
    self.identity = UUID()
  }
}

struct PlaybackDeleteTargets: Equatable {
  let current: Bool
  let prepared: Bool

  var any: Bool { current || prepared }
}

// Two native slots protect at most CURRENT and one prepared NEXT. Export/share
// leases remain in Library; Delete blocks new reservations and must retire both
// matching slots before the managed file can be physically removed.
@MainActor
final class PlaybackLeaseCoordinator {
  private(set) var current: PlaybackOccurrence?
  private(set) var prepared: PlaybackOccurrence?
  private var deleting = Set<String>()

  func reserveCurrent(_ occurrence: PlaybackOccurrence) -> Bool {
    guard !deleting.contains(occurrence.libraryID), current == nil, prepared == nil else {
      return false
    }
    current = occurrence
    return true
  }

  func reservePrepared(_ occurrence: PlaybackOccurrence) -> Bool {
    guard current != nil, prepared == nil,
          current?.identity != occurrence.identity,
          !deleting.contains(occurrence.libraryID) else { return false }
    prepared = occurrence
    return true
  }

  func promotePrepared(_ occurrence: PlaybackOccurrence,
                       replacing previous: PlaybackOccurrence) -> Bool {
    guard prepared == occurrence, current == previous,
          !deleting.contains(occurrence.libraryID),
          !deleting.contains(previous.libraryID) else { return false }
    current = occurrence
    prepared = nil
    return true
  }

  func ownsCurrent(_ occurrence: PlaybackOccurrence) -> Bool {
    current == occurrence && !deleting.contains(occurrence.libraryID)
  }

  func ownsPrepared(_ occurrence: PlaybackOccurrence) -> Bool {
    prepared == occurrence && !deleting.contains(occurrence.libraryID)
  }

  func retains(_ id: String) -> Bool {
    current?.libraryID == id || prepared?.libraryID == id
  }

  func beginDelete(_ id: String) -> PlaybackDeleteTargets {
    deleting.insert(id)
    return PlaybackDeleteTargets(current: current?.libraryID == id,
      prepared: prepared?.libraryID == id)
  }

  func endDelete(_ id: String) { deleting.remove(id) }

  @discardableResult
  func releaseCurrent(_ occurrence: PlaybackOccurrence) -> Bool {
    guard current == occurrence else { return false }
    current = nil
    return true
  }

  @discardableResult
  func releasePrepared(_ occurrence: PlaybackOccurrence) -> Bool {
    guard prepared == occurrence else { return false }
    prepared = nil
    return true
  }

  func isDeleting(_ id: String) -> Bool { deleting.contains(id) }
}
