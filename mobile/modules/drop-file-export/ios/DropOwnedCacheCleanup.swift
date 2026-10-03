import Foundation

struct DropCacheCleanupResult {
  let removed: Int
  let failures: Int
}

enum DropOwnedCacheCleanup {
  private static let startupLock = NSLock()
  private static var didRunAtStartup = false

  static func runOnceAtStartup(
    cacheDirectory: URL,
    fileManager: FileManager = .default
  ) -> DropCacheCleanupResult {
    startupLock.lock()
    defer { startupLock.unlock() }
    guard !didRunAtStartup else { return DropCacheCleanupResult(removed: 0, failures: 0) }
    didRunAtStartup = true
    return run(cacheDirectory: cacheDirectory, fileManager: fileManager)
  }

  static func run(
    cacheDirectory: URL,
    fileManager: FileManager = .default
  ) -> DropCacheCleanupResult {
    var removed = 0
    var failures = 0
    func remove(_ url: URL) {
      do {
        try fileManager.removeItem(at: url)
        removed += 1
      } catch {
        failures += 1
        let failure = error as NSError
        NSLog("[Drop files] Startup cleanup failed (%@:%ld)", failure.domain, failure.code)
      }
    }

    for rootName in ["MediaDrop", "DropExport"] {
      let ownedRoot = cacheDirectory.appendingPathComponent(rootName, isDirectory: true)
      if let rootValues = try? ownedRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
         rootValues.isDirectory == true,
         rootValues.isSymbolicLink != true {
        do {
          for item in try fileManager.contentsOfDirectory(
            at: ownedRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]
          ) {
            guard UUID(uuidString: item.lastPathComponent) != nil else { continue }
            let values = try item.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { continue }
            remove(item)
          }
          if (try? fileManager.contentsOfDirectory(atPath: ownedRoot.path).isEmpty) == true {
            remove(ownedRoot)
          }
        } catch {
          failures += 1
          let failure = error as NSError
          NSLog("[Drop files] Startup workspace scan failed (%@:%ld)", failure.domain, failure.code)
        }
      }
    }

    do {
      for item in try fileManager.contentsOfDirectory(
        at: cacheDirectory,
        includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]
      ) {
        guard isOwnedDirectFile(item.lastPathComponent) else { continue }
        let values = try item.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
        remove(item)
      }
    } catch {
      failures += 1
      let failure = error as NSError
      NSLog("[Drop files] Startup direct-file scan failed (%@:%ld)", failure.domain, failure.code)
    }
    return DropCacheCleanupResult(removed: removed, failures: failures)
  }

  static func isOwnedDirectFile(_ name: String) -> Bool {
    let prefix = "mediadrop-"
    guard name.hasPrefix(prefix) else { return false }
    let remainder = name.dropFirst(prefix.count)
    guard remainder.count > 33 else { return false }
    let jobID = remainder.prefix(32)
    return jobID.allSatisfy { $0.isHexDigit }
      && remainder.dropFirst(32).first == "-"
  }
}
