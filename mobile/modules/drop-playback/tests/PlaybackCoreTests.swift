import Foundation
import SQLite3

@main
struct PlaybackCoreTests {
  static func main() async throws {
    try await MainActor.run {
      let leases = PlaybackLeaseCoordinator()
      try check(leases.reserve("first"))
      try check(!leases.reserve("second"))
      try check(leases.owns("first"))
      try check(leases.beginDelete("first"))
      try check(!leases.owns("first"))
      try check(!leases.reserve("first"))
      leases.release("first")
      try check(!leases.beginDelete("second"))
      leases.endDelete("first")
      leases.endDelete("second")
      try check(leases.reserve("second"))
      leases.release("second")
      leases.release("second") // idempotent close
      try check(leases.currentID == nil)
    }

    try check(PlaybackPolicy.supported(extension: "mp4", mediaType: "video"))
    try check(PlaybackPolicy.supported(extension: "m4a", mediaType: "audio"))
    try check(!PlaybackPolicy.supported(extension: "mp3", mediaType: "audio"))
    try check(!PlaybackPolicy.supported(extension: "mp4", mediaType: "audio"))
    try check(PlaybackPolicy.rates == [0.75, 1, 1.25, 1.5, 1.75, 2])
    try check(PlaybackPolicy.clamped(-15, duration: 120) == 0)
    try check(PlaybackPolicy.clamped(135, duration: 120) == 120)
    try check(PlaybackPolicy.clamped(30, duration: 120) == 30)
    try check(PlaybackPolicy.clamped(Double.nan, duration: 120) == nil)
    try check(PlaybackPolicy.clamped(5, duration: Double.infinity) == nil)
    try check(!PlaybackPolicy.completed(position: 113, duration: 120))
    try check(PlaybackPolicy.completed(position: 114, duration: 120))
    try check(!PlaybackPolicy.completed(position: 7_169, duration: 7_200))
    try check(PlaybackPolicy.completed(position: 7_170, duration: 7_200))
    try check(!PlaybackPolicy.completed(position: 1, duration: Double.nan))
    try check(PlaybackPolicy.restored(position: 55, duration: 120, wasCompleted: false) == 55)
    try check(PlaybackPolicy.restored(position: 55, duration: 120, wasCompleted: true) == 0)
    try check(PlaybackPolicy.restored(position: Double.nan, duration: 120, wasCompleted: false) == 0)
    try check(!PlaybackPolicy.shouldPersist(elapsed: 11.9, hasProgress: true))
    try check(PlaybackPolicy.shouldPersist(elapsed: 12, hasProgress: true))
    try check(!PlaybackPolicy.shouldPersist(elapsed: 15, hasProgress: false))
    try check(!PlaybackPolicy.shouldPersist(elapsed: Double.nan, hasProgress: true))

    let base = FileManager.default.temporaryDirectory
      .appendingPathComponent("DropPlaybackTests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: base) }
    let databaseURL = base.appendingPathComponent("library.sqlite")
    let db = try open(databaseURL)
    try execute(db, "PRAGMA journal_mode=WAL; CREATE TABLE library_items(id TEXT PRIMARY KEY, lifecycle TEXT, relativeMediaPath TEXT, mediaType TEXT, sizeBytes INTEGER, playbackPositionSeconds REAL, completedAt TEXT, title TEXT, relativeArtworkPath TEXT);")
    let id = "00000000-0000-0000-0000-000000000001"
    try execute(db, "INSERT INTO library_items VALUES ('\(id)', 'ready', 'Media/\(id).m4a', 'audio', 100, 42, NULL, 'Podcast local', NULL)")
    let repository = SQLitePlaybackProgressRepository(databaseURL: databaseURL)
    let loaded = try await repository.load(id: id)
    try check(loaded.position == 42 && loaded.completedAt == nil)
    try check(loaded.relativeMediaPath == "Media/\(id).m4a")
    try check(loaded.title == "Podcast local")
    try await repository.save(id: id, position: 55, completedAt: nil)
    let at55 = try await repository.load(id: id)
    try check(at55.position == 55)
    try await repository.save(id: id, position: 100, completedAt: "2026-10-03T00:00:00Z")
    let finished = try await repository.load(id: id)
    try check(finished.completedAt != nil)
    try await repository.save(id: id, position: 10, completedAt: nil)
    let resumed = try await repository.load(id: id)
    try check(resumed.completedAt == nil)
    try execute(db, "UPDATE library_items SET lifecycle = 'deleting' WHERE id = '\(id)'")
    do {
      _ = try await repository.load(id: id)
      fatalError("Deleting item must not load")
    } catch PlaybackRepositoryError.invalidRecord {}
    try execute(db, "UPDATE library_items SET lifecycle = 'ready' WHERE id = '\(id)'")
    try execute(db, "BEGIN IMMEDIATE")
    let start = Date()
    do {
      try await repository.save(id: id, position: 77, completedAt: nil)
      fatalError("Expected bounded SQLITE_BUSY")
    } catch PlaybackRepositoryError.busy {
      try check(Date().timeIntervalSince(start) < 2)
    }
    try execute(db, "ROLLBACK")
    let afterBusy = try await repository.load(id: id)
    try check(afterBusy.position == 10)
    try await repository.save(id: id, position: 77, completedAt: nil)
    let afterRecovery = try await repository.load(id: id)
    try check(afterRecovery.position == 77)
    sqlite3_close(db)
    print("PlaybackCoreTests: passed")
  }

  private static func check(_ condition: @autoclosure () throws -> Bool) throws {
    if try !condition() { fatalError("PlaybackCoreTests failed") }
  }

  private static func open(_ url: URL) throws -> OpaquePointer {
    var db: OpaquePointer?
    guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else {
      throw PlaybackRepositoryError.unavailable
    }
    return db
  }

  private static func execute(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
      throw PlaybackRepositoryError.unavailable
    }
  }
}
