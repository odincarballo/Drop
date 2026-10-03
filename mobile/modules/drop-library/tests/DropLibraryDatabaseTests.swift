import Foundation
import SQLite3

@main
enum DropLibraryDatabaseTests {
  static func main() throws {
    let manager = FileManager.default
    let base = manager.temporaryDirectory.appendingPathComponent("DropLibraryDatabaseTests-\(UUID().uuidString)")
    defer { try? manager.removeItem(at: base) }
    let support = base.appendingPathComponent("Library/Application Support", isDirectory: true)
    let canonical = support.appendingPathComponent("Drop", isDirectory: true)
    let legacy = DropLibraryDatabase.legacyRoot(for: canonical)
    let media = canonical.appendingPathComponent("Media", isDirectory: true)
    let artwork = canonical.appendingPathComponent("Artwork", isDirectory: true)
    try manager.createDirectory(at: media, withIntermediateDirectories: true)
    try manager.createDirectory(at: artwork, withIntermediateDirectories: true)
    let mediaFile = media.appendingPathComponent("00000000-0000-0000-0000-000000000001.mp4")
    let artworkFile = artwork.appendingPathComponent("00000000-0000-0000-0000-000000000001.jpg")
    try Data([1, 2, 3]).write(to: mediaFile)
    try Data([4, 5, 6]).write(to: artworkFile)

    let orphan = canonical.appendingPathComponent(".library-migration-\(UUID().uuidString).sqlite")
    try Data([7]).write(to: orphan)
    try Data([8]).write(to: URL(fileURLWithPath: orphan.path + "-wal"))
    try Data([9]).write(to: URL(fileURLWithPath: orphan.path + "-shm"))
    let unrelated = canonical.appendingPathComponent("other.sqlite-shm")
    try Data([10]).write(to: unrelated)

    // Clean installation: Expo receives a file URL, not a raw path that it
    // would re-encode into a literal Application%20Support directory.
    try check(DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy) == canonical)
    try check(migrationArtifacts(in: canonical).isEmpty)
    try check(manager.fileExists(atPath: unrelated.path))
    try check(manager.fileExists(atPath: mediaFile.path) && manager.fileExists(atPath: artworkFile.path))
    try check(DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy) == canonical)
    try check(migrationArtifacts(in: canonical).isEmpty)
    let databaseDirectoryURL = canonical.absoluteString
    let openedPath = URL(string: databaseDirectoryURL + "library.sqlite")!.path
    try check(openedPath == canonical.appendingPathComponent("library.sqlite").path)
    try check(!manager.fileExists(atPath: legacy.path))

    // Legacy-only WAL database: the backup must include committed WAL rows.
    try manager.createDirectory(at: legacy, withIntermediateDirectories: true)
    let oldDB = legacy.appendingPathComponent("library.sqlite")
    try createDatabase(oldDB, count: 2, persistentWAL: true)
    try check(manager.fileExists(atPath: oldDB.path + "-wal"))
    try check(manager.fileExists(atPath: oldDB.path + "-shm"))

    // A failed backup may already have created its database and sidecars.
    // All three are owned temporaries; the valid legacy database survives.
    do {
      _ = try DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy,
                                          backupOperation: { _, temporary in
        try Data([1]).write(to: temporary)
        try Data([2]).write(to: URL(fileURLWithPath: temporary.path + "-wal"))
        try Data([3]).write(to: URL(fileURLWithPath: temporary.path + "-shm"))
        throw DropLibraryDatabaseError.migrationFailed
      })
      fatalError("Expected backup failure")
    } catch DropLibraryDatabaseError.migrationFailed {
      try check(readCount(oldDB) == 2)
      try check(!manager.fileExists(atPath: canonical.appendingPathComponent("library.sqlite").path))
      try check(migrationArtifacts(in: canonical).isEmpty)
    }

    try check(DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy) == canonical)
    let newDB = canonical.appendingPathComponent("library.sqlite")
    try check(readCount(newDB) == 2)
    try check(readLifecycle(newDB) == "pending")
    try check(!manager.fileExists(atPath: oldDB.path))
    try check(!manager.fileExists(atPath: oldDB.path + "-wal"))
    try check(!manager.fileExists(atPath: oldDB.path + "-shm"))
    try check(migrationArtifacts(in: canonical).isEmpty)
    try check(manager.fileExists(atPath: mediaFile.path) && manager.fileExists(atPath: artworkFile.path))

    // The real database's sidecar names are never part of the migration namespace.
    let activeWAL = URL(fileURLWithPath: newDB.path + "-wal")
    let activeSHM = URL(fileURLWithPath: newDB.path + "-shm")
    try Data([11]).write(to: activeWAL)
    try Data([12]).write(to: activeSHM)
    try check(DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy) == canonical)
    try check(manager.fileExists(atPath: activeWAL.path) && manager.fileExists(atPath: activeSHM.path))
    try manager.removeItem(at: activeWAL)
    try manager.removeItem(at: activeSHM)
    try check(readCount(newDB) == 2)

    // The common legacy layout without persistent WAL also migrates.
    try manager.removeItem(at: newDB)
    try manager.createDirectory(at: legacy, withIntermediateDirectories: true)
    try createDatabase(oldDB, count: 1, persistentWAL: false)
    try check(DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy) == canonical)
    try check(readCount(newDB) == 1)
    try check(!manager.fileExists(atPath: oldDB.path))
    try check(migrationArtifacts(in: canonical).isEmpty)

    // Both databases: no overwrite, cleanup, or arbitrary selection.
    try manager.createDirectory(at: legacy, withIntermediateDirectories: true)
    try createDatabase(oldDB, count: 3, persistentWAL: false)
    do {
      _ = try DropLibraryDatabase.prepare(canonicalRoot: canonical, legacyRoot: legacy)
      fatalError("Expected conflict")
    } catch DropLibraryDatabaseError.conflict {
      try check(readCount(newDB) == 1 && readCount(oldDB) == 3)
    }
    print("DropLibraryDatabaseTests: passed")
  }

  private static func migrationArtifacts(in root: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix(".library-migration-") }
  }

  private static func check(_ condition: @autoclosure () throws -> Bool) throws {
    if try !condition() { fatalError("DropLibraryDatabaseTests failed") }
  }

  private static func createDatabase(_ url: URL, count: Int, persistentWAL: Bool) throws {
    var db: OpaquePointer?
    guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { fatalError("SQLite open failed") }
    try execute(db, "PRAGMA journal_mode=WAL; CREATE TABLE library_items(id TEXT PRIMARY KEY, lifecycle TEXT, relativeMediaPath TEXT, relativeArtworkPath TEXT);")
    for index in 0..<count {
      try execute(db, "INSERT INTO library_items VALUES ('\(index)', 'pending', 'Media/\(index).mp4', 'Artwork/\(index).jpg');")
    }
    if persistentWAL {
      var enabled: Int32 = 1
      guard sqlite3_file_control(db, "main", SQLITE_FCNTL_PERSIST_WAL, &enabled) == SQLITE_OK else {
        fatalError("Could not persist WAL")
      }
    }
    sqlite3_close(db)
  }

  private static func readCount(_ url: URL) throws -> Int64 {
    var db: OpaquePointer?
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
      fatalError("SQLite read failed")
    }
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM library_items", -1, &statement, nil) == SQLITE_OK,
          sqlite3_step(statement) == SQLITE_ROW else { fatalError("SQLite count failed") }
    defer { sqlite3_finalize(statement) }
    return sqlite3_column_int64(statement, 0)
  }

  private static func readLifecycle(_ url: URL) throws -> String {
    var db: OpaquePointer?
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
      fatalError("SQLite read failed")
    }
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT lifecycle, relativeMediaPath, relativeArtworkPath FROM library_items WHERE id='0'", -1, &statement, nil) == SQLITE_OK,
          sqlite3_step(statement) == SQLITE_ROW else { fatalError("SQLite metadata failed") }
    defer { sqlite3_finalize(statement) }
    let lifecycle = String(cString: sqlite3_column_text(statement, 0))
    let mediaPath = String(cString: sqlite3_column_text(statement, 1))
    let artworkPath = String(cString: sqlite3_column_text(statement, 2))
    guard mediaPath == "Media/0.mp4", artworkPath == "Artwork/0.jpg" else {
      fatalError("Relative paths changed")
    }
    return lifecycle
  }

  private static func execute(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { fatalError("SQLite exec failed") }
  }
}
