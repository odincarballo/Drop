import Foundation
import SQLite3

enum DropLibraryDatabaseError: LocalizedError {
  case conflict
  case migrationFailed
  case cleanupFailed

  var errorDescription: String? {
    switch self {
    case .conflict:
      return "Existen dos bases de Biblioteca. Se conservaron ambas; se requiere resolver el conflicto antes de abrirla."
    case .migrationFailed:
      return "No se pudo migrar la Biblioteca. Los datos anteriores se conservaron."
    case .cleanupFailed:
      return "No se pudieron limpiar los archivos temporales de migración de la Biblioteca."
    }
  }
}

// Runs before Expo SQLite opens the database. SQLite's backup API includes committed WAL
// pages without copying a possibly inconsistent database/WAL/SHM file triplet.
enum DropLibraryDatabase {
  private static let migrationLock = NSLock()
  private static let migrationPrefix = ".library-migration-"

  static func legacyRoot(for canonicalRoot: URL) -> URL {
    canonicalRoot.deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("Application%20Support", isDirectory: true)
      .appendingPathComponent("Drop", isDirectory: true)
  }

  static func prepare(canonicalRoot: URL, legacyRoot: URL,
                      manager: FileManager = .default,
                      backupOperation: ((URL, URL) throws -> Void)? = nil) throws -> URL {
    migrationLock.lock()
    defer { migrationLock.unlock() }
    // prepare runs before the normal Expo SQLite connection opens. These exact
    // migration names can only belong to a previous, no-longer-running attempt.
    try cleanupMigrationArtifacts(in: canonicalRoot, manager: manager)
    let canonical = canonicalRoot.appendingPathComponent("library.sqlite")
    let legacy = legacyRoot.appendingPathComponent("library.sqlite")
    let hasCanonical = manager.fileExists(atPath: canonical.path)
    let hasLegacy = manager.fileExists(atPath: legacy.path)
    if hasCanonical && hasLegacy { throw DropLibraryDatabaseError.conflict }
    if !hasLegacy { return canonicalRoot }
    do {
      // Only the known legacy database and its SQLite sidecars may be read.
      // Never follow a symlink out of Drop's sandbox-owned directory.
      let legacyDirectoryValues = try legacyRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard legacyDirectoryValues.isDirectory == true,
            legacyDirectoryValues.isSymbolicLink != true else {
        throw DropLibraryDatabaseError.migrationFailed
      }
      for name in ["library.sqlite", "library.sqlite-wal", "library.sqlite-shm"] {
        let file = legacyRoot.appendingPathComponent(name)
        guard manager.fileExists(atPath: file.path) else { continue }
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
          throw DropLibraryDatabaseError.migrationFailed
        }
      }

      let temporary = canonicalRoot.appendingPathComponent("\(migrationPrefix)\(UUID().uuidString).sqlite")
      let expectedCount = try countAndCheck(legacy, flags: SQLITE_OPEN_READONLY)
      if let backupOperation {
        try backupOperation(legacy, temporary)
      } else {
        try backup(from: legacy, to: temporary)
      }
      try makeStandalone(temporary)
      let actualCount = try countAndCheck(temporary, flags: SQLITE_OPEN_READONLY)
      guard expectedCount == actualCount else { throw DropLibraryDatabaseError.migrationFailed }
      // moveItem does not replace an existing database. The legacy files stay untouched
      // until the canonical copy has passed integrity and record-count verification.
      guard !manager.fileExists(atPath: canonical.path) else { throw DropLibraryDatabaseError.conflict }
      try manager.moveItem(at: temporary, to: canonical)
      guard try countAndCheck(canonical, flags: SQLITE_OPEN_READONLY) == expectedCount else {
        throw DropLibraryDatabaseError.migrationFailed
      }
      try cleanupMigrationArtifacts(in: canonicalRoot, manager: manager)
      for name in ["library.sqlite", "library.sqlite-wal", "library.sqlite-shm"] {
        let file = legacyRoot.appendingPathComponent(name)
        if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
      }
      if (try? manager.contentsOfDirectory(atPath: legacyRoot.path).isEmpty) == true {
        try manager.removeItem(at: legacyRoot)
        let parent = legacyRoot.deletingLastPathComponent()
        if (try? manager.contentsOfDirectory(atPath: parent.path).isEmpty) == true {
          try manager.removeItem(at: parent)
        }
      }
      return canonicalRoot
    } catch let error as DropLibraryDatabaseError {
      try cleanupMigrationArtifacts(in: canonicalRoot, manager: manager)
      throw error
    } catch {
      try cleanupMigrationArtifacts(in: canonicalRoot, manager: manager)
      throw DropLibraryDatabaseError.migrationFailed
    }
  }

  private static func isMigrationArtifact(_ name: String) -> Bool {
    let stem: String
    if name.hasSuffix(".sqlite-wal") || name.hasSuffix(".sqlite-shm") {
      stem = String(name.dropLast(4))
    } else {
      stem = name
    }
    guard stem.hasPrefix(migrationPrefix), stem.hasSuffix(".sqlite") else { return false }
    let identifier = String(stem.dropFirst(migrationPrefix.count).dropLast(".sqlite".count))
    guard let uuid = UUID(uuidString: identifier) else { return false }
    return uuid.uuidString.caseInsensitiveCompare(identifier) == .orderedSame
  }

  private static func cleanupMigrationArtifacts(in root: URL, manager: FileManager) throws {
    do {
      let files = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: [
        .isRegularFileKey, .isSymbolicLinkKey
      ])
      for file in files where isMigrationArtifact(file.lastPathComponent) {
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
          throw DropLibraryDatabaseError.cleanupFailed
        }
        try manager.removeItem(at: file)
      }
    } catch {
      throw DropLibraryDatabaseError.cleanupFailed
    }
  }

  private static func open(_ url: URL, flags: Int32) throws -> OpaquePointer {
    var db: OpaquePointer?
    guard sqlite3_open_v2(url.path, &db, flags, nil) == SQLITE_OK, let db else {
      if let db { sqlite3_close(db) }
      throw DropLibraryDatabaseError.migrationFailed
    }
    return db
  }

  private static func countAndCheck(_ url: URL, flags: Int32) throws -> Int64 {
    let db = try open(url, flags: flags)
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, "PRAGMA integrity_check", -1, &statement, nil) == SQLITE_OK else {
      throw DropLibraryDatabaseError.migrationFailed
    }
    guard sqlite3_step(statement) == SQLITE_ROW,
          String(cString: sqlite3_column_text(statement, 0)) == "ok" else {
      sqlite3_finalize(statement)
      throw DropLibraryDatabaseError.migrationFailed
    }
    sqlite3_finalize(statement)
    statement = nil
    guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM library_items", -1, &statement, nil) == SQLITE_OK else {
      throw DropLibraryDatabaseError.migrationFailed
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { throw DropLibraryDatabaseError.migrationFailed }
    return sqlite3_column_int64(statement, 0)
  }

  private static func backup(from source: URL, to target: URL) throws {
    let sourceDB = try open(source, flags: SQLITE_OPEN_READONLY)
    defer { sqlite3_close(sourceDB) }
    let targetDB = try open(target, flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
    defer { sqlite3_close(targetDB) }
    guard let operation = sqlite3_backup_init(targetDB, "main", sourceDB, "main") else {
      throw DropLibraryDatabaseError.migrationFailed
    }
    let result = sqlite3_backup_step(operation, -1)
    let finish = sqlite3_backup_finish(operation)
    guard result == SQLITE_DONE, finish == SQLITE_OK else {
      throw DropLibraryDatabaseError.migrationFailed
    }
  }

  private static func makeStandalone(_ url: URL) throws {
    let db = try open(url, flags: SQLITE_OPEN_READWRITE)
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, "PRAGMA journal_mode=DELETE", -1, &statement, nil) == SQLITE_OK else {
      throw DropLibraryDatabaseError.migrationFailed
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW,
          String(cString: sqlite3_column_text(statement, 0)).lowercased() == "delete" else {
      throw DropLibraryDatabaseError.migrationFailed
    }
  }
}
