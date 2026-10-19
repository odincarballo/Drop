import Foundation

// An in-memory snapshot of the visible, playable IDs supplied by the tap.
// The database and managed storage remain authoritative for every open.
struct PlaybackContext {
  let orderedIds: [String]
  private(set) var currentIndex: Int

  init(startID: String, orderedIds: [String]) throws {
    guard !orderedIds.isEmpty,
          orderedIds.count == Set(orderedIds).count,
          let index = orderedIds.firstIndex(of: startID),
          orderedIds.allSatisfy({ id in
            guard let uuid = UUID(uuidString: id) else { return false }
            return uuid.uuidString.lowercased() == id
          }) else { throw PlaybackContextError.invalid }
    self.orderedIds = orderedIds
    currentIndex = index
  }

  var currentID: String { orderedIds[currentIndex] }

  mutating func promote(_ id: String) -> Bool {
    guard let index = orderedIds.firstIndex(of: id), index > currentIndex else { return false }
    currentIndex = index
    return true
  }

  mutating func takeNextID() -> String? {
    guard currentIndex + 1 < orderedIds.count else { return nil }
    currentIndex += 1
    return orderedIds[currentIndex]
  }
}

enum PlaybackContextError: Error { case invalid }
