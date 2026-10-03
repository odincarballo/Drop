import Foundation

@main
enum DropExportAliasTests {
  static func main() throws {
    let manager = FileManager.default
    let temporary = manager.temporaryDirectory.appendingPathComponent(
      "DropExportAliasTests-\(UUID().uuidString)", isDirectory: true
    )
    defer { try? manager.removeItem(at: temporary) }
    let support = temporary.appendingPathComponent("Support", isDirectory: true)
    let cache = temporary.appendingPathComponent("Caches", isDirectory: true)
    let media = support.appendingPathComponent("Drop/Media", isDirectory: true)
    try manager.createDirectory(at: media, withIntermediateDirectories: true)
    try manager.createDirectory(at: cache, withIntermediateDirectories: true)
    let id = UUID().uuidString.lowercased()
    let source = media.appendingPathComponent("\(id).mp4")
    try Data("original media".utf8).write(to: source)
    let export = try DropExportAlias(cacheDirectory: cache, supportDirectory: support)

    let alias = try export.create(sourceURI: source.absoluteString,
                                  name: "Este video lo borraré en 48 horas.mp4")
    let sourceAttributes = try manager.attributesOfItem(atPath: source.path)
    let aliasAttributes = try manager.attributesOfItem(atPath: alias.path)
    guard alias.lastPathComponent == "Este video lo borraré en 48 horas.mp4",
          sourceAttributes[.systemFileNumber] as? NSNumber == aliasAttributes[.systemFileNumber] as? NSNumber,
          try Data(contentsOf: alias) == Data("original media".utf8) else {
      fatalError("Alias must have a friendly name and share the original inode")
    }
    try export.remove(aliasURI: alias.absoluteString)
    guard manager.fileExists(atPath: source.path),
          !manager.fileExists(atPath: alias.path),
          !manager.fileExists(atPath: alias.deletingLastPathComponent().path) else {
      fatalError("Removing the alias must preserve Library media")
    }

    for name in ["../escape.mp4", ".mp4", "video.m4a", "video\\name.mp4"] {
      do {
        _ = try export.create(sourceURI: source.absoluteString, name: name)
        fatalError("Invalid export name accepted: \(name)")
      } catch DropExportAliasError.invalidName {
        // Expected.
      }
    }
    let outside = cache.appendingPathComponent("\(id).mp4")
    try Data("foreign".utf8).write(to: outside)
    do {
      _ = try export.create(sourceURI: outside.absoluteString, name: "Video.mp4")
      fatalError("A file outside Library Media was accepted")
    } catch DropExportAliasError.invalidSource {
      // Expected.
    }
    print("DropExportAliasTests: passed")
  }
}
