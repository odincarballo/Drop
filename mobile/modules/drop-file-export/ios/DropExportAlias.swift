import Foundation

enum DropExportAliasError: Error {
  case invalidSource
  case invalidName
  case invalidAlias
}

/// A named hard link lets iOS display a friendly filename without copying a large Library file.
final class DropExportAlias {
  private let manager: FileManager
  private let media: URL
  private let root: URL

  static func live() throws -> DropExportAlias {
    let manager = FileManager.default
    guard let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask).first,
          let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      throw DropExportAliasError.invalidSource
    }
    return try DropExportAlias(cacheDirectory: cache, supportDirectory: support, manager: manager)
  }

  init(cacheDirectory: URL, supportDirectory: URL, manager: FileManager = .default) throws {
    self.manager = manager
    media = supportDirectory.standardizedFileURL.resolvingSymlinksInPath()
      .appendingPathComponent("Drop/Media", isDirectory: true)
    root = cacheDirectory.standardizedFileURL.resolvingSymlinksInPath()
      .appendingPathComponent("DropExport", isDirectory: true)
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true,
          root.resolvingSymlinksInPath() == root.standardizedFileURL else {
      throw DropExportAliasError.invalidAlias
    }
  }

  func create(sourceURI: String, name: String) throws -> URL {
    guard let sourceURL = URL(string: sourceURI), sourceURL.isFileURL else {
      throw DropExportAliasError.invalidSource
    }
    let source = sourceURL.standardizedFileURL
    let sourceValues = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    let ext = source.pathExtension.lowercased()
    guard source.resolvingSymlinksInPath().deletingLastPathComponent() == media,
          sourceValues.isRegularFile == true, sourceValues.isSymbolicLink != true,
          UUID(uuidString: source.deletingPathExtension().lastPathComponent) != nil,
          ["mp4", "m4a", "mp3", "aac"].contains(ext) else {
      throw DropExportAliasError.invalidSource
    }
    guard Self.validName(name), name.pathExtension.lowercased() == ext else {
      throw DropExportAliasError.invalidName
    }
    let workspace = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    try manager.createDirectory(at: workspace, withIntermediateDirectories: false)
    let alias = workspace.appendingPathComponent(name)
    do {
      try manager.linkItem(at: source, to: alias)
      return alias
    } catch {
      try? manager.removeItem(at: workspace)
      throw error
    }
  }

  func remove(aliasURI: String) throws {
    guard let aliasURL = URL(string: aliasURI), aliasURL.isFileURL else {
      throw DropExportAliasError.invalidAlias
    }
    let alias = aliasURL.standardizedFileURL
    let workspace = alias.deletingLastPathComponent()
    guard workspace.deletingLastPathComponent() == root,
          UUID(uuidString: workspace.lastPathComponent) != nil,
          Self.validName(alias.lastPathComponent),
          alias.resolvingSymlinksInPath() == alias else {
      throw DropExportAliasError.invalidAlias
    }
    if manager.fileExists(atPath: alias.path) {
      let values = try alias.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      guard values.isRegularFile == true, values.isSymbolicLink != true else {
        throw DropExportAliasError.invalidAlias
      }
      try manager.removeItem(at: alias)
    }
    if (try? manager.contentsOfDirectory(atPath: workspace.path).isEmpty) == true {
      try manager.removeItem(at: workspace)
    }
  }

  private static func validName(_ name: String) -> Bool {
    let scalars = name.unicodeScalars
    return !name.isEmpty && name != "." && name != ".." && name.utf8.count <= 240
      && !name.hasPrefix(".") && !name.hasSuffix(".")
      && !scalars.contains(where: { $0.value < 32 || $0.value == 127
        || "/\\:*?\"<>|".unicodeScalars.contains($0) })
  }
}

private extension String {
  var pathExtension: String { URL(fileURLWithPath: self).pathExtension }
}
