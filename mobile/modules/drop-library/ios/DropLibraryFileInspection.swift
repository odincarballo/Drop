import Foundation
import ImageIO

enum DropLibraryStorageError: Error {
  case invalidIdentifier, invalidSource, invalidManagedPath, missingFile, invalidImage
  case insufficientSpace, backupExcluded
}

enum DropLibraryFileInspection {
  static func regularSize(_ url: URL, manager: FileManager = .default) throws -> Int64? {
    let attributes: [FileAttributeKey: Any]
    do { attributes = try manager.attributesOfItem(atPath: url.path) }
    catch {
      let error = error as NSError
      if error.domain == NSCocoaErrorDomain &&
          (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError) { return nil }
      throw error // Permission/protection failures are not evidence of absence.
    }
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          DropLibraryPaths.isUnredirected(url),
          let size = attributes[.size] as? NSNumber else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    return size.int64Value
  }

  static func artworkSize(_ url: URL, manager: FileManager = .default) throws -> Int64? {
    guard let size = try regularSize(url, manager: manager), size > 0, size <= 2 * 1_048_576 else { return nil }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    // Bound allocation even if a restoring writer grows the file after stat.
    let data = try handle.read(upToCount: 2 * 1_048_576 + 1) ?? Data()
    guard data.count == size,
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          CGImageSourceGetCount(source) > 0,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 4096, height <= 4096,
          width * height <= 16_000_000,
          CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 512
          ] as CFDictionary) != nil,
          CGImageSourceGetStatus(source) == .statusComplete,
          CGImageSourceGetStatusAtIndex(source, 0) == .statusComplete else { return nil }

    return size // Reads never remove a partially restored or invalid image.
  }
  static func artworkIDs(in directory: URL, manager: FileManager = .default) throws -> [String] {
    try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).compactMap { url in
      guard url.pathExtension.lowercased() == "jpg",
            let id = DropLibraryPaths.identifier(url.deletingPathExtension().lastPathComponent),
            (try? regularSize(url, manager: manager)) != nil else { return nil }
      return id // Enumeration is read-only, including invalid/truncated images.
    }
  }

}
