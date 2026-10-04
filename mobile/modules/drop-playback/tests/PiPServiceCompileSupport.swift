import UIKit

// The normal iOS target gets this from the Expo AppDelegate subscriber file.
// This test-only definition lets the service be typechecked without Expo.
@MainActor
enum DropPlaybackOrientation {
  static var fullscreen = false
}

final class DropLibraryStorage {
  let root: URL
  init(root: URL) { self.root = root }
  convenience init() throws {
    self.init(root: FileManager.default.temporaryDirectory)
  }
  func managedMedia(relative: String) throws -> (URL, Int64)? { nil }
  func managedArtwork(id: String) throws -> (URL, Int64)? { nil }
}
