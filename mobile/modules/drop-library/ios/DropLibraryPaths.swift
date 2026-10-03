import Foundation

enum DropLibraryPaths {
  static func identifier(_ id: String) -> String? {
    guard let uuid = UUID(uuidString: id), uuid.uuidString == id.uppercased() else { return nil }
    return uuid.uuidString.lowercased()
  }

  static func fileExtension(_ value: String) -> String? {
    let lower = value.lowercased()
    return ["mp4", "m4a", "mp3", "aac"].contains(lower) ? lower : nil
  }

  static func ownedCachePath(_ relative: String) -> Bool {
    let parts = relative.split(separator: "/").map(String.init)
    if parts.count == 3, parts[0] == "MediaDrop", UUID(uuidString: parts[1]) != nil {
      return ["mp4", "m4a"].contains(URL(fileURLWithPath: parts[2]).pathExtension.lowercased())
        && !parts[2].hasPrefix(".") && !parts[2].contains("\\")
    }
    if parts.count == 1, parts[0].hasPrefix("mediadrop-") {
      let remainder = parts[0].dropFirst("mediadrop-".count)
      return remainder.count > 33 && remainder.prefix(32).allSatisfy(\.isHexDigit)
        && remainder.dropFirst(32).first == "-"
        && fileExtension(URL(fileURLWithPath: parts[0]).pathExtension) != nil
    }
    return false
  }

  static func managedMediaPath(_ relative: String) -> Bool {
    let parts = relative.split(separator: "/").map(String.init)
    guard parts.count == 2, parts[0] == "Media", relative == "Media/\(parts[1])" else {
      return false
    }
    let url = URL(fileURLWithPath: parts[1])
    return identifier(url.deletingPathExtension().lastPathComponent) != nil
      && fileExtension(url.pathExtension) != nil
  }
}
