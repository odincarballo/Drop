import Foundation
import SQLite3

private enum TestFailure: Error { case sqlite(String), assertion(String) }

private let a = "00000000-0000-0000-0000-000000000001"
private let b = "00000000-0000-0000-0000-000000000002"
private let c = "00000000-0000-0000-0000-000000000003"
private let first = "10000000-0000-0000-0000-000000000001"
private let second = "10000000-0000-0000-0000-000000000002"
private let third = "10000000-0000-0000-0000-000000000003"

@main
enum PlaybackManualQueueRepositoryTests {
  static func main() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("DropManualQueueRepositoryTests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    try await missingAndSchemaTests(root)
    try await readAndConsumeTests(root)
    try await rollbackTests(root)
    try await concurrencyTests(root)
    try await corruptionTests(root)
    print("PlaybackManualQueueRepositoryTests: passed")
  }

  private static func missingAndSchemaTests(_ root: URL) async throws {
    let missing = root.appendingPathComponent("missing.sqlite")
    let repository = SQLitePlaybackManualQueueRepository(databaseURL: missing)
    do { _ = try await repository.pendingEntries(); throw TestFailure.assertion("missing accepted") }
    catch PlaybackManualQueueError.unavailable {}
    try check(!FileManager.default.fileExists(atPath: missing.path), "reader created database")

    let version = root.appendingPathComponent("version.sqlite")
    try fixture(version)
    try withDB(version) { db in try exec(db, "PRAGMA user_version = 2") }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: version).pendingEntries()
      throw TestFailure.assertion("v2 accepted") }
    catch PlaybackManualQueueError.schemaNotPrepared {}
    try check(try scalar(version, "PRAGMA user_version") == 2, "v2 was migrated")
    try withDB(version) { db in try exec(db, "PRAGMA user_version = 4") }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: version).pendingEntries()
      throw TestFailure.assertion("future version accepted") }
    catch PlaybackManualQueueError.incompatibleSchema {}
    try check(try scalar(version, "PRAGMA user_version") == 4, "future version was touched")
    try withDB(version) { db in
      try exec(db, "PRAGMA user_version = 3; DROP INDEX playback_queue_position")
    }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: version).pendingEntries()
      throw TestFailure.assertion("missing unique index accepted") }
    catch PlaybackManualQueueError.incompatibleSchema {}

    let malformed = root.appendingPathComponent("malformed.sqlite")
    try fixture(malformed)
    try withDB(malformed) { db in try exec(db, "ALTER TABLE playback_queue ADD COLUMN extra TEXT") }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: malformed).pendingEntries()
      throw TestFailure.assertion("extra schema column accepted") }
    catch PlaybackManualQueueError.incompatibleSchema {}
  }

  private static func readAndConsumeTests(_ root: URL) async throws {
    let url = root.appendingPathComponent("ordered.sqlite")
    try fixture(url)
    try withDB(url) { db in
      try seedLibrary(db)
      try seedQueue(db, id: first, item: a, position: 0)
      try seedQueue(db, id: second, item: a, position: 3)
      try seedQueue(db, id: third, item: b, position: 8)
    }
    let repository: PlaybackManualQueueRepository =
      SQLitePlaybackManualQueueRepository(databaseURL: url)
    let initial = try await repository.pendingEntries()
    try check(initial.map(\.entryID) == [first, second, third], "wrong read order")
    try check(initial.map(\.position) == [0, 3, 8], "read unexpectedly compacted")
    try check(initial.allSatisfy { $0.lifecycle == .ready }, "wrong ready state")
    try check(try scalar(url, "SELECT COUNT(*) FROM playback_queue") == 3,
      "read changed queue")

    let mismatch = try await repository.consume(entryID: first, itemID: b)
    try check(mismatch == .itemMismatch,
      "item mismatch consumed")
    let missing = try await repository.consume(entryID: c, itemID: a)
    try check(missing == .missing,
      "missing entry consumed")
    try withDB(url) { db in
      try exec(db, "UPDATE library_items SET lifecycle = 'deleting' WHERE id = '\(b)'")
    }
    let deleting = try await repository.pendingEntries()
    try check(deleting.last?.lifecycle == .deleting, "deleting state was not reported")
    let notReady = try await repository.consume(entryID: third, itemID: b)
    try check(notReady == .notReady,
      "deleting entry consumed")
    try withDB(url) { db in
      try exec(db, "UPDATE library_items SET lifecycle = 'ready' WHERE id = '\(b)'")
    }

    let consumed = try await repository.consume(entryID: second, itemID: a)
    try check(consumed == .persisted,
      "conditional consume failed")
    let after = try await repository.pendingEntries()
    try check(after.map(\.entryID) == [first, third], "wrong survivors")
    try check(after.map(\.position) == [0, 1], "consume did not compact")
    let alreadyConsumed = try await repository.consume(entryID: second, itemID: a)
    try check(alreadyConsumed == .missing,
      "same occurrence consumed twice")
    try check(try scalar(url, "SELECT COUNT(*) FROM library_items") == 3,
      "consume changed Library")
    try check(try scalar(url, "PRAGMA foreign_key_check(playback_queue)") == -1,
      "consume broke foreign keys")

    // Library deletion on another connection cascades both occurrences of a.
    try withDB(url) { db in try exec(db, "PRAGMA foreign_keys = ON; DELETE FROM library_items WHERE id = '\(a)'") }
    let afterCascade = try await repository.pendingEntries()
    try check(afterCascade.map(\.entryID) == [third],
      "Library cascade did not remove pending occurrence")
    let lastConsumed = try await repository.consume(entryID: third, itemID: b)
    try check(lastConsumed == .persisted,
      "last entry did not consume")
    let empty = try await repository.pendingEntries()
    try check(empty.isEmpty, "queue not empty")
    do { _ = try await repository.consume(entryID: "not-an-id", itemID: a)
      throw TestFailure.assertion("invalid id accepted") }
    catch PlaybackManualQueueError.invalidEntry {}
  }

  private static func rollbackTests(_ root: URL) async throws {
    let url = root.appendingPathComponent("rollback.sqlite")
    try fixture(url)
    try withDB(url) { db in
      try seedLibrary(db)
      try seedQueue(db, id: first, item: a, position: 0)
      try seedQueue(db, id: second, item: b, position: 1)
      try exec(db, "CREATE TRIGGER reject_compact BEFORE UPDATE OF position ON playback_queue " +
        "BEGIN SELECT RAISE(ABORT, 'forced'); END")
    }
    let repository = SQLitePlaybackManualQueueRepository(databaseURL: url)
    do { _ = try await repository.consume(entryID: first, itemID: a)
      throw TestFailure.assertion("trigger failure ignored") }
    catch PlaybackManualQueueError.storageFailure {}
    let afterFailure = try await repository.pendingEntries()
    try check(afterFailure.map(\.entryID) == [first, second], "rollback lost row")
    try check(afterFailure.map(\.position) == [0, 1], "rollback changed position")
    try withDB(url) { db in try exec(db, "DROP TRIGGER reject_compact") }
    let retried = try await repository.consume(entryID: first, itemID: a)
    try check(retried == .persisted,
      "retry after rollback failed")
    let afterRetry = try await repository.pendingEntries()
    try check(afterRetry.first?.position == 0,
      "retry did not compact")
  }

  private static func concurrencyTests(_ root: URL) async throws {
    let url = root.appendingPathComponent("concurrent.sqlite")
    try fixture(url)
    try withDB(url) { db in
      try seedLibrary(db)
      try seedQueue(db, id: first, item: a, position: 0)
    }
    let left = SQLitePlaybackManualQueueRepository(databaseURL: url)
    let right = SQLitePlaybackManualQueueRepository(databaseURL: url)
    async let firstResult = left.consume(entryID: first, itemID: a)
    async let secondResult = right.consume(entryID: first, itemID: a)
    let results = try await [firstResult, secondResult]
    try check(results.filter { $0 == .persisted }.count == 1, "double consume")
    try check(results.filter { $0 == .missing }.count == 1, "missing not reported")

    try withDB(url) { db in try seedQueue(db, id: second, item: b, position: 0) }
    let lock = try open(url)
    try exec(lock, "BEGIN IMMEDIATE")
    do { _ = try await left.consume(entryID: second, itemID: b)
      throw TestFailure.assertion("write lock ignored") }
    catch PlaybackManualQueueError.busy {}
    try exec(lock, "ROLLBACK")
    sqlite3_close(lock)
    let afterLock = try await left.consume(entryID: second, itemID: b)
    try check(afterLock == .persisted,
      "busy retry lost entry")
  }

  private static func corruptionTests(_ root: URL) async throws {
    let url = root.appendingPathComponent("orphan.sqlite")
    try fixture(url)
    try withDB(url) { db in
      try exec(db, "PRAGMA foreign_keys = OFF")
      try seedQueue(db, id: first, item: a, position: 0)
    }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: url).pendingEntries()
      throw TestFailure.assertion("orphan accepted") }
    catch PlaybackManualQueueError.invalidEntry {}
    try check(try scalar(url, "SELECT COUNT(*) FROM playback_queue") == 1,
      "corrupt data was repaired destructively")

    let lifecycle = root.appendingPathComponent("lifecycle.sqlite")
    try fixture(lifecycle)
    try withDB(lifecycle) { db in
      try seedLibrary(db)
      try seedQueue(db, id: second, item: b, position: 0)
      try exec(db, "PRAGMA ignore_check_constraints = ON; " +
        "UPDATE library_items SET lifecycle = 'unknown' WHERE id = '\(b)'")
    }
    do { _ = try await SQLitePlaybackManualQueueRepository(databaseURL: lifecycle).pendingEntries()
      throw TestFailure.assertion("invalid lifecycle accepted") }
    catch PlaybackManualQueueError.invalidEntry {}
    try check(try scalar(lifecycle, "SELECT COUNT(*) FROM playback_queue") == 1,
      "invalid lifecycle entry was removed")
  }

  private static func fixture(_ url: URL) throws {
    try withDB(url) { db in
      try exec(db, "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; " +
        "CREATE TABLE library_items (id TEXT PRIMARY KEY NOT NULL, " +
        "lifecycle TEXT NOT NULL CHECK(lifecycle IN ('pending','ready','deleting'))); " +
        "CREATE TABLE playback_queue (id TEXT PRIMARY KEY NOT NULL, " +
        "itemId TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE, " +
        "position INTEGER NOT NULL CHECK(position >= 0), addedAt TEXT NOT NULL); " +
        "CREATE UNIQUE INDEX playback_queue_position ON playback_queue(position); " +
        "CREATE INDEX playback_queue_by_item ON playback_queue(itemId, position); " +
        "PRAGMA user_version = 3")
    }
  }

  private static func seedLibrary(_ db: OpaquePointer) throws {
    for id in [a, b, c] {
      try exec(db, "INSERT INTO library_items VALUES ('\(id)', 'ready')")
    }
  }

  private static func seedQueue(_ db: OpaquePointer, id: String, item: String,
                                position: Int) throws {
    try exec(db, "INSERT INTO playback_queue VALUES " +
      "('\(id)', '\(item)', \(position), '2026-10-25T00:00:00.000Z')")
  }

  private static func withDB<T>(_ url: URL, _ body: (OpaquePointer) throws -> T) throws -> T {
    let db = try open(url)
    defer { sqlite3_close(db) }
    return try body(db)
  }

  private static func open(_ url: URL) throws -> OpaquePointer {
    var handle: OpaquePointer?
    guard sqlite3_open_v2(url.path, &handle,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
      let db = handle else {
      if let handle { sqlite3_close(handle) }
      throw TestFailure.sqlite("open fixture")
    }
    sqlite3_busy_timeout(db, 500)
    return db
  }

  private static func exec(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
      throw TestFailure.sqlite(String(cString: sqlite3_errmsg(db)))
    }
  }

  private static func scalar(_ url: URL, _ sql: String) throws -> Int64 {
    try withDB(url) { db in
      var statement: OpaquePointer?
      guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK,
        let statement else { throw TestFailure.sqlite("prepare scalar") }
      defer { sqlite3_finalize(statement) }
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { return -1 }
      guard step == SQLITE_ROW else { throw TestFailure.sqlite("step scalar") }
      return sqlite3_column_int64(statement, 0)
    }
  }

  private static func check(_ value: @autoclosure () throws -> Bool,
                            _ message: String) throws {
    if try !value() { throw TestFailure.assertion(message) }
  }
}
