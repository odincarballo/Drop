import Foundation

@main
struct PlaybackContextTests {
  static func main() throws {
    let a = "00000000-0000-0000-0000-000000000001"
    let b = "00000000-0000-0000-0000-000000000002"
    let c = "00000000-0000-0000-0000-000000000003"
    var context = try PlaybackContext(startID: b, orderedIds: [a, b, c])
    precondition(context.currentID == b)
    precondition(context.promote(c))
    precondition(context.currentID == c)
    precondition(!context.promote(a))
    context = try PlaybackContext(startID: b, orderedIds: [a, b, c])
    precondition(context.takeNextID() == c)
    precondition(context.takeNextID() == nil) // No rewind, wrap or repeat.
    precondition(context.takeNextID() == nil)
    for ids in [[a, a], ["file:///tmp/x"], []] {
      do {
        _ = try PlaybackContext(startID: a, orderedIds: ids)
        fatalError("Invalid playback context accepted")
      } catch PlaybackContextError.invalid {}
    }
    do {
      _ = try PlaybackContext(startID: b, orderedIds: [a, c])
      fatalError("Missing start accepted")
    } catch PlaybackContextError.invalid {}
    print("PlaybackContextTests: passed")
  }
}
