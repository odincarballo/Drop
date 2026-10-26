import Foundation

enum PlaybackNextChoice: Equatable {
  case manual(PlaybackManualQueueEntry)
  case context(index: Int, id: String)

  var libraryID: String {
    switch self {
    case .manual(let entry): entry.itemID
    case .context(_, let id): id
    }
  }

  var occurrence: PlaybackOccurrence {
    switch self {
    case .manual(let entry):
      PlaybackOccurrence(libraryID: entry.itemID, source: .manual(entryID: entry.entryID))
    case .context(let index, let id):
      PlaybackOccurrence(libraryID: id, source: .context(index: index))
    }
  }
}

// The SQLite snapshot determines priority. Rejections and consumed occurrences
// are session-local; neither preparing nor rejecting a row mutates the queue.
@MainActor
final class PlaybackNextSelector {
  private(set) var rejectedManual = Set<String>()
  private(set) var consumedManual = Set<String>()
  private(set) var rejectedContext = Set<Int>()

  func resetSession() {
    rejectedManual.removeAll()
    consumedManual.removeAll()
    rejectedContext.removeAll()
  }

  func resetContext() { rejectedContext.removeAll() }

  func choose(entries: [PlaybackManualQueueEntry], context: PlaybackContext?) -> PlaybackNextChoice? {
    for entry in entries where entry.lifecycle == .ready {
      if !rejectedManual.contains(entry.entryID) && !consumedManual.contains(entry.entryID) {
        return .manual(entry)
      }
    }
    guard let context, context.currentIndex + 1 < context.orderedIds.count else { return nil }
    for index in (context.currentIndex + 1)..<context.orderedIds.count {
      if !rejectedContext.contains(index) {
        return .context(index: index, id: context.orderedIds[index])
      }
    }
    return nil
  }

  func reject(_ choice: PlaybackNextChoice) {
    switch choice {
    case .manual(let entry): rejectedManual.insert(entry.entryID)
    case .context(let index, _): rejectedContext.insert(index)
    }
  }

  func began(_ entryID: String) { consumedManual.insert(entryID) }
}
