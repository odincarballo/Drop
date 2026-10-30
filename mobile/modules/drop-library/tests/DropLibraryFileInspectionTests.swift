import Foundation
import ImageIO
import CoreGraphics

private final class InaccessibleFileManager: FileManager, @unchecked Sendable {
  override func attributesOfItem(atPath path: String) throws -> [FileAttributeKey: Any] {
    throw CocoaError(.fileReadNoPermission)
  }
}

@main
struct DropLibraryFileInspectionTests {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent("drop-inspection-\(UUID())")
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    var assertions = 0
    func check(_ condition: Bool) throws {
      guard condition else { throw NSError(domain: "DropLibraryFileInspectionTests", code: assertions) }
      assertions += 1
    }
    let id = "00000000-0000-0000-0000-000000000001"
    let url = root.appendingPathComponent("\(id).jpg")
    try check(try DropLibraryFileInspection.regularSize(url) == nil)
    try Data().write(to: url)
    try check(try DropLibraryFileInspection.artworkSize(url) == nil)
    try check(manager.fileExists(atPath: url.path))
    let invalid = Data("not an image".utf8)
    try invalid.write(to: url)
    try check(try DropLibraryFileInspection.artworkSize(url) == nil)
    try check(try Data(contentsOf: url) == invalid)
    try check(try DropLibraryFileInspection.artworkIDs(in: root) == [id])

    let context = CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8,
      bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.setFillColor(CGColor(red: 0, green: 0.5, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
    let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    try check(CGImageDestinationFinalize(destination))
    let valid = try Data(contentsOf: url)
    try check(try DropLibraryFileInspection.artworkSize(url) == Int64(valid.count))
    try check(try Data(contentsOf: url) == valid)
    try valid.prefix(20).write(to: url)
    try check(try DropLibraryFileInspection.artworkSize(url) == nil)
    try check(try Data(contentsOf: url) == valid.prefix(20))
    try check(try DropLibraryFileInspection.artworkIDs(in: root) == [id])
    try valid.write(to: url)
    try check(try DropLibraryFileInspection.artworkSize(url) == Int64(valid.count))

    let unknown = root.appendingPathComponent("unexpected.jpg")
    try invalid.write(to: unknown)
    _ = try DropLibraryFileInspection.artworkIDs(in: root)
    try check(manager.fileExists(atPath: unknown.path))
    let symlink = root.appendingPathComponent("00000000-0000-0000-0000-000000000002.jpg")
    try manager.createSymbolicLink(at: symlink, withDestinationURL: url)
    var rejected = false
    do { _ = try DropLibraryFileInspection.regularSize(symlink) }
    catch DropLibraryStorageError.invalidManagedPath { rejected = true }
    try check(rejected)
    try check(try Data(contentsOf: url) == valid)
    try check(try DropLibraryFileInspection.artworkIDs(in: root) == [id])
    var propagated = false
    do { _ = try DropLibraryFileInspection.regularSize(url, manager: InaccessibleFileManager()) }
    catch { propagated = (error as NSError).code == NSFileReadNoPermissionError }
    try check(propagated)
    try check(try Data(contentsOf: url) == valid)
    print("DropLibraryFileInspectionTests: passed (\(assertions) assertions)")
  }
}
