import Foundation

// The player has one native lease. JavaScript export/share leases remain in
// Library; deletion first blocks new player opens, closes this lease, then
// waits for the existing JavaScript leases before physically removing media.
@MainActor
final class PlaybackLeaseCoordinator {
  private(set) var currentID: String?
  private var deleting = Set<String>()

  func reserve(_ id: String) -> Bool {
    guard !deleting.contains(id), currentID == nil else { return false }
    currentID = id
    return true
  }

  func owns(_ id: String) -> Bool {
    currentID == id && !deleting.contains(id)
  }

  func beginDelete(_ id: String) -> Bool {
    deleting.insert(id)
    return currentID == id
  }

  func endDelete(_ id: String) { deleting.remove(id) }

  func release(_ id: String) {
    if currentID == id { currentID = nil }
  }

  func isDeleting(_ id: String) -> Bool { deleting.contains(id) }
}
