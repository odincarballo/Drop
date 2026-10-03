import Foundation

@main
enum DropLibraryPathsTests {
  static func main() throws {
    let id = "00000000-0000-0000-0000-000000000001"
    guard DropLibraryPaths.identifier(id) == id,
          DropLibraryPaths.identifier("../../bad") == nil,
          DropLibraryPaths.managedMediaPath("Media/\(id).mp4"),
          DropLibraryPaths.managedMediaPath("Media/\(id).m4a"),
          !DropLibraryPaths.managedMediaPath("Media/../\(id).mp4"),
          !DropLibraryPaths.managedMediaPath("Media/\(id).part"),
          !DropLibraryPaths.managedMediaPath("Media/\(id).mp4/other"),
          DropLibraryPaths.ownedCachePath("MediaDrop/\(id)/video.mp4"),
          !DropLibraryPaths.ownedCachePath("MediaDrop/\(id)/video.part"),
          !DropLibraryPaths.ownedCachePath("../MediaDrop/\(id)/video.mp4"),
          DropLibraryPaths.ownedCachePath("mediadrop-0123456789abcdef0123456789abcdef-audio.mp3"),
          !DropLibraryPaths.ownedCachePath("mediadrop-0123456789abcdef0123456789abcdef-audio.part") else {
      fatalError("DropLibraryPaths tests failed")
    }
    print("DropLibraryPathsTests: passed")
  }
}
