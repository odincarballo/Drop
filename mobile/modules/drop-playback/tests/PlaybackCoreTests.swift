import Foundation
import SQLite3

@main
struct PlaybackCoreTests {
  static func main() async throws {
    try await MainActor.run {
      let leases = PlaybackLeaseCoordinator()
      let currentA = PlaybackOccurrence(libraryID: "A", source: .direct)
      let nextB = PlaybackOccurrence(libraryID: "B", source: .context(index: 1))
      let nextA = PlaybackOccurrence(libraryID: "A", source: .manual(entryID: "entry-A"))
      let staleA = PlaybackOccurrence(libraryID: "A", source: .manual(entryID: "entry-A"))
      try check(leases.reserveCurrent(currentA))
      try check(!leases.reserveCurrent(nextB))
      try check(leases.ownsCurrent(currentA))
      try check(leases.reservePrepared(nextB))
      try check(leases.retains("A") && leases.retains("B"))
      try check(!leases.reservePrepared(nextA)) // Two-slot window only.
      try check(!leases.releasePrepared(staleA)) // Stale callback cannot free B.
      try check(leases.ownsPrepared(nextB))
      try check(!leases.promotePrepared(staleA, replacing: currentA))
      try check(leases.releasePrepared(nextB)) // Cancelling NEXT preserves CURRENT.
      try check(leases.ownsCurrent(currentA) && !leases.retains("B"))
      let replacementB = PlaybackOccurrence(libraryID: "B", source: .context(index: 1))
      try check(leases.reservePrepared(replacementB))
      try check(!leases.releasePrepared(nextB)) // Old generation, same Library ID.
      try check(leases.ownsPrepared(replacementB))
      try check(leases.releasePrepared(replacementB))
      try check(leases.reservePrepared(nextA)) // A and A are distinct occurrences.
      try check(nextA.identity != currentA.identity)
      try check(leases.current == currentA && leases.prepared == nextA)
      try check(leases.retains("A"))
      try check(leases.releasePrepared(nextA)) // Cancel NEXT A without releasing CURRENT A.
      try check(leases.ownsCurrent(currentA) && leases.retains("A"))
      let replayA = PlaybackOccurrence(libraryID: "A", source: .manual(entryID: "entry-A"))
      try check(leases.reservePrepared(replayA))
      try check(!leases.releasePrepared(nextA)) // Stale callback for the same entry ID.
      try check(leases.ownsPrepared(replayA))
      try check(!leases.releaseCurrent(staleA))
      try check(!leases.promotePrepared(replayA, replacing: staleA))
      try check(leases.promotePrepared(replayA, replacing: currentA))
      try check(leases.current == replayA && leases.prepared == nil)
      try check(!leases.releaseCurrent(currentA)) // Old completion cannot free new A.
      try check(leases.retains("A"))
      try check(leases.releaseCurrent(replayA))
      try check(!leases.releaseCurrent(replayA)) // Idempotent close.

      let currentA2 = PlaybackOccurrence(libraryID: "A", source: .direct)
      let nextB2 = PlaybackOccurrence(libraryID: "B", source: .context(index: 1))
      let nextA2 = PlaybackOccurrence(libraryID: "A", source: .manual(entryID: "entry-A2"))
      try check(leases.reserveCurrent(currentA2))
      try check(leases.reservePrepared(nextB2))
      let deleteNext = leases.beginDelete("B")
      try check(!deleteNext.current && deleteNext.prepared)
      try check(!leases.ownsPrepared(nextB2))
      try check(!leases.reservePrepared(staleA)) // Occupied slot.
      try check(leases.releasePrepared(nextB2))
      try check(leases.ownsCurrent(currentA2) && !leases.retains("B"))
      leases.endDelete("B")
      try check(leases.reservePrepared(nextA2))
      let deleteBoth = leases.beginDelete("A")
      try check(deleteBoth.current && deleteBoth.prepared)
      try check(!leases.ownsCurrent(currentA2) && !leases.ownsPrepared(nextA2))
      try check(!leases.promotePrepared(nextA2, replacing: currentA2))
      try check(!leases.reserveCurrent(staleA))
      try check(leases.releasePrepared(nextA2))
      try check(leases.retains("A")) // CURRENT still protects the file.
      try check(leases.releaseCurrent(currentA2))
      try check(!leases.retains("A"))
      leases.endDelete("A")
      let currentB = PlaybackOccurrence(libraryID: "B", source: .direct)
      try check(leases.reserveCurrent(currentB))
      let deleteCurrent = leases.beginDelete("B")
      try check(deleteCurrent.current && !deleteCurrent.prepared)
      try check(leases.releaseCurrent(currentB))
      leases.endDelete("B")
      try check(leases.current == nil && leases.prepared == nil)
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
