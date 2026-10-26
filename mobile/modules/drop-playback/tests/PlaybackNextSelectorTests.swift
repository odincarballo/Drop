import Foundation

private enum SelectorTestError: Error { case failed }

@main
@MainActor
enum PlaybackNextSelectorTests {
  static func main() throws {
    let a = "00000000-0000-0000-0000-000000000001"
    let b = "00000000-0000-0000-0000-000000000002"
    let c = "00000000-0000-0000-0000-000000000003"
    let x = "10000000-0000-0000-0000-000000000001"
    let y = "10000000-0000-0000-0000-000000000002"
    let entries = [
      PlaybackManualQueueEntry(entryID: x, itemID: c, position: 0,
        addedAt: "2026-10-25T00:00:00.000Z", lifecycle: .ready),
      PlaybackManualQueueEntry(entryID: y, itemID: b, position: 1,
        addedAt: "2026-10-25T00:00:01.000Z", lifecycle: .ready)
    ]
    var context = try PlaybackContext(startID: a, orderedIds: [a, b, c])
    let selector = PlaybackNextSelector()
    try check(selector.choose(entries: entries, context: context) == .manual(entries[0]))
    selector.began(x)
    try check(selector.choose(entries: entries, context: context) == .manual(entries[1]))
    selector.began(y)
    // Manual B does not deduplicate or advance contextual B.
    try check(selector.choose(entries: entries, context: context) == .context(index: 1, id: b))
    try check(context.currentIndex == 0) // Preparation did not advance it.
    try check(context.promote(b))
    try check(selector.choose(entries: entries, context: context) == .context(index: 2, id: c))
    try check(context.promote(c))
    try check(selector.choose(entries: entries, context: context) == nil)

    // A rejected row remains in SQLite but is not retried in this session.
    selector.resetSession()
    selector.reject(.manual(entries[0]))
    try check(selector.choose(entries: entries, context: nil) == .manual(entries[1]))
    selector.reject(.manual(entries[1]))
    try check(selector.choose(entries: entries, context: nil) == nil)
    selector.resetSession()
    try check(selector.choose(entries: entries, context: nil) == .manual(entries[0]))

    let repeated = PlaybackManualQueueEntry(entryID: y, itemID: c, position: 1,
      addedAt: "2026-10-25T00:00:01.000Z", lifecycle: .ready)
    selector.began(x)
    try check(selector.choose(entries: [entries[0], repeated], context: nil) == .manual(repeated))
    selector.resetSession()

    // Non-ready rows cannot become NEXT; Context is still eligible.
    let deleting = PlaybackManualQueueEntry(entryID: x, itemID: c, position: 0,
      addedAt: "2026-10-25T00:00:00.000Z", lifecycle: .deleting)
    context = try PlaybackContext(startID: a, orderedIds: [a, b])
    try check(selector.choose(entries: [deleting], context: context) == .context(index: 1, id: b))
    print("PlaybackNextSelectorTests: passed")
  }

  private static func check(_ value: Bool) throws {
    if !value { throw SelectorTestError.failed }
  }
}
