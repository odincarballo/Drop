import Foundation

enum DropLibraryPaths {
  enum MediaFolder: String, CaseIterable {
    case downloaded = "Media"
    case imported = "ImportedMedia"

    init?(origin: String) {
      switch origin {
      case "youtube", "direct": self = .downloaded
      case "local": self = .imported
      default: return nil
      }
    }

    func accepts(_ ext: String) -> Bool {
      DropLibraryPaths.fileExtension(ext) != nil && (self == .downloaded || ext.lowercased() != "aac")
    }
  }

  static func identifier(_ id: String) -> String? {
    guard let uuid = UUID(uuidString: id), uuid.uuidString == id.uppercased() else { return nil }
    return uuid.uuidString.lowercased()
  }

  static func fileExtension(_ value: String) -> String? {
    let lower = value.lowercased()
    return ["mp4", "m4a", "mp3", "aac"].contains(lower) ? lower : nil
  }

  static func systemPath(_ path: String) -> String {
    // Foundation can report these system aliases differently for enumerated URLs.
    if path == "/var" || path.hasPrefix("/var/") { return "/private" + path }
    if path == "/tmp" || path.hasPrefix("/tmp/") { return "/private" + path }
    return path
  }

  static func isUnredirected(_ url: URL) -> Bool {
    systemPath(url.resolvingSymlinksInPath().path) == systemPath(url.standardizedFileURL.path)
  }

  static func ownedCachePath(_ relative: String) -> Bool {
    if importedStagingID(relative) != nil { return true }
    let parts = relative.split(separator: "/").map(String.init)
    guard relative == parts.joined(separator: "/"), !relative.contains("\\") else { return false }
    if parts.count == 3, parts[0] == "MediaDrop", UUID(uuidString: parts[1]) != nil {
      return ["mp4", "m4a"].contains(URL(fileURLWithPath: parts[2]).pathExtension.lowercased())
        && !parts[2].hasPrefix(".")
    }
    if parts.count == 1, parts[0].hasPrefix("mediadrop-") {
      let remainder = parts[0].dropFirst("mediadrop-".count)
      return remainder.count > 33 && remainder.prefix(32).allSatisfy(\.isHexDigit)
        && remainder.dropFirst(32).first == "-"
        && fileExtension(URL(fileURLWithPath: parts[0]).pathExtension) != nil
    }
    return false
  }

  static func importedStagingID(_ relative: String, prefix: String = "payload") -> String? {
    let parts = relative.split(separator: "/").map(String.init)
    guard parts.count == 3, parts[0] == "DropImport",
          let id = identifier(parts[1]), id == parts[1],
          let ext = parts[2].split(separator: ".").last.map(String.init),
          ext == ext.lowercased(), MediaFolder.imported.accepts(ext),
          relative == "DropImport/\(id)/\(prefix).\(ext)" else { return nil }
    return id
  }

  static func managedMediaFolder(_ relative: String) -> MediaFolder? {
    let parts = relative.split(separator: "/").map(String.init)
    guard parts.count == 2, let folder = MediaFolder(rawValue: parts[0]),
          relative == "\(folder.rawValue)/\(parts[1])" else { return nil }
    let url = URL(fileURLWithPath: parts[1])
    guard let id = identifier(url.deletingPathExtension().lastPathComponent),
          folder.accepts(url.pathExtension) else { return nil }
    if folder == .imported && parts[1] != "\(id).\(url.pathExtension.lowercased())" { return nil }
    return folder
  }

  static func managedMediaPath(_ relative: String) -> Bool {
    managedMediaFolder(relative) != nil
  }
}
