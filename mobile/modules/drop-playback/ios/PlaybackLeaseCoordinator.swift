import Foundation

// The queue retains at most its current item and one prepared successor.
// JavaScript export/share leases remain in Library; Delete blocks new opens,
// retires either native lease, then waits for JavaScript leases before removal.
@MainActor
final class PlaybackLeaseCoordinator {
  private(set) var currentID: String?
  private(set) var preparedID: String?
  private var deleting = Set<String>()

  func reserve(_ id: String) -> Bool {
    guard !deleting.contains(id), currentID == nil else { return false }
    currentID = id
    return true
  }

  func reservePrepared(_ id: String) -> Bool {
    guard currentID != nil, preparedID == nil, currentID != id,
          !deleting.contains(id) else { return false }
    preparedID = id
    return true
  }

  func promotePrepared(_ id: String) -> String? {
    guard preparedID == id else { return nil }
    let previous = currentID
    currentID = id
    preparedID = nil
    return previous
  }

  func owns(_ id: String) -> Bool {
    currentID == id && !deleting.contains(id)
  }

  func retains(_ id: String) -> Bool { currentID == id || preparedID == id }

  func ownsPrepared(_ id: String) -> Bool {
    preparedID == id && !deleting.contains(id)
  }

  func beginDelete(_ id: String) -> Bool {
    deleting.insert(id)
    return retains(id)
  }

  func endDelete(_ id: String) { deleting.remove(id) }

  func release(_ id: String) {
    if currentID == id { currentID = nil }
    if preparedID == id { preparedID = nil }
  }

  func isDeleting(_ id: String) -> Bool { deleting.contains(id) }
}
