import Foundation
import SQLite3

private let queueSQLiteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum PlaybackManualQueueError: Error, Equatable, Sendable {
  case unavailable
  case schemaNotPrepared
  case incompatibleSchema
  case foreignKeysUnavailable
  case invalidEntry
  case busy
  case storageFailure
}

enum PlaybackManualQueueLifecycle: String, Sendable {
  case pending, ready, deleting
}

struct PlaybackManualQueueEntry: Equatable, Sendable {
  let entryID: String
  let itemID: String
  let position: Int64
  let addedAt: String
  let lifecycle: PlaybackManualQueueLifecycle
}

enum PlaybackManualQueueConsumeResult: Equatable, Sendable {
  // The SQLite transaction committed. B2 must report native reconciliation
  // separately; a later AVQueuePlayer failure cannot roll this result back.
  case persisted
  case missing
  case itemMismatch
  case notReady
}

// This is an injectable contract for Block B2. The repository only owns the
// durable pending rows; the playback service will own selection and AVQueuePlayer.
protocol PlaybackManualQueueRepository: AnyObject {
  func pendingEntries() async throws -> [PlaybackManualQueueEntry]
  func consume(entryID: String, itemID: String) async throws -> PlaybackManualQueueConsumeResult
}

// A separate, short-lived connection is necessary while Expo SQLite owns its
// UI connection. Never create or migrate the database from this native reader.
final class SQLitePlaybackManualQueueRepository: PlaybackManualQueueRepository,
  @unchecked Sendable {
  private let databaseURL: URL
  private let queue = DispatchQueue(label: "com.drop.playback.manual-queue")

  init(databaseURL: URL) { self.databaseURL = databaseURL }

  func pendingEntries() async throws -> [PlaybackManualQueueEntry] {
    try await queued { db in
      let rows = try self.entries(in: db)
      var previous: Int64 = -1
      for row in rows {
        guard row.position > previous else { throw PlaybackManualQueueError.invalidEntry }
        previous = row.position
      }
      return rows
    }
  }

  func consume(entryID: String, itemID: String) async throws -> PlaybackManualQueueConsumeResult {
    guard Self.canonicalID(entryID), Self.canonicalID(itemID) else {
      throw PlaybackManualQueueError.invalidEntry
    }
    return try await queued { db in
      try self.execute(db, "BEGIN IMMEDIATE")
      do {
        let result = try self.consumeInTransaction(db, entryID: entryID, itemID: itemID)
        try self.execute(db, "COMMIT")
        return result
      } catch {
        try? self.execute(db, "ROLLBACK")
        throw error
      }
    }
  }

  private func consumeInTransaction(_ db: OpaquePointer, entryID: String,
                                    itemID: String) throws -> PlaybackManualQueueConsumeResult {
    let found: (String, PlaybackManualQueueLifecycle)? = try {
      let lookup = try prepare(db,
        "SELECT q.itemId, l.lifecycle FROM playback_queue q " +
        "LEFT JOIN library_items l ON l.id = q.itemId WHERE q.id = ?")
      defer { sqlite3_finalize(lookup) }
      try bind(entryID, to: lookup, at: 1, db: db)
      switch sqlite3_step(lookup) {
      case SQLITE_DONE: return nil
      case SQLITE_ROW: break
      default: throw sqliteError(db)
      }
      guard let storedItemID = textColumn(lookup, 0), Self.canonicalID(storedItemID),
            let lifecycleRaw = textColumn(lookup, 1),
            let lifecycle = PlaybackManualQueueLifecycle(rawValue: lifecycleRaw) else {
        throw PlaybackManualQueueError.invalidEntry
      }
      return (storedItemID, lifecycle)
    }()
    guard let (storedItemID, lifecycle) = found else { return .missing }
    guard storedItemID == itemID else { return .itemMismatch }
    guard lifecycle == .ready else { return .notReady }

    let deletion = try prepare(db,
      "DELETE FROM playback_queue WHERE id = ? AND itemId = ? " +
      "AND EXISTS (SELECT 1 FROM library_items " +
      "WHERE id = playback_queue.itemId AND lifecycle = 'ready')")
    defer { sqlite3_finalize(deletion) }
    try bind(entryID, to: deletion, at: 1, db: db)
    try bind(itemID, to: deletion, at: 2, db: db)
    guard sqlite3_step(deletion) == SQLITE_DONE else { throw sqliteError(db) }
    guard sqlite3_changes(db) == 1 else { throw PlaybackManualQueueError.storageFailure }
    try compact(in: db)
    return .persisted
  }

  private func compact(in db: OpaquePointer) throws {
    let rows = try entries(in: db)
    guard !rows.isEmpty else { return }
    let count = Int64(rows.count)
    let highest = rows[rows.count - 1].position
    let (offset, overflow1) = highest.addingReportingOverflow(count)
    let (base, overflow2) = offset.addingReportingOverflow(1)
    let (_, overflow3) = base.addingReportingOverflow(count)
    guard !overflow1, !overflow2, !overflow3 else {
      throw PlaybackManualQueueError.invalidEntry
    }
    // SQLite UNIQUE indexes are immediate: first move into a disjoint range,
    // then write compact positions, all inside the same transaction.
    let update = try prepare(db, "UPDATE playback_queue SET position = ? WHERE id = ?")
    defer { sqlite3_finalize(update) }
    for (index, row) in rows.enumerated() {
      try updatePosition(base + Int64(index), id: row.entryID, statement: update, db: db)
    }
    for (index, row) in rows.enumerated() {
      try updatePosition(Int64(index), id: row.entryID, statement: update, db: db)
    }
  }

  private func updatePosition(_ position: Int64, id: String, statement: OpaquePointer,
                              db: OpaquePointer) throws {
    guard sqlite3_reset(statement) == SQLITE_OK else { throw sqliteError(db) }
    sqlite3_clear_bindings(statement)
    guard sqlite3_bind_int64(statement, 1, position) == SQLITE_OK else { throw sqliteError(db) }
    try bind(id, to: statement, at: 2, db: db)
    guard sqlite3_step(statement) == SQLITE_DONE, sqlite3_changes(db) == 1 else {
      throw sqliteError(db)
    }
  }

  private func entries(in db: OpaquePointer) throws -> [PlaybackManualQueueEntry] {
    let statement = try prepare(db,
      "SELECT q.id, q.itemId, q.position, q.addedAt, l.lifecycle " +
      "FROM playback_queue q LEFT JOIN library_items l ON l.id = q.itemId " +
      "ORDER BY q.position ASC, q.id ASC")
    defer { sqlite3_finalize(statement) }
    var rows: [PlaybackManualQueueEntry] = []
    while true {
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { return rows }
      guard step == SQLITE_ROW else { throw sqliteError(db) }
      guard let entryID = textColumn(statement, 0), Self.canonicalID(entryID),
            let itemID = textColumn(statement, 1), Self.canonicalID(itemID),
            sqlite3_column_type(statement, 2) == SQLITE_INTEGER,
            let addedAt = textColumn(statement, 3), !addedAt.isEmpty,
            let lifecycleRaw = textColumn(statement, 4),
            let lifecycle = PlaybackManualQueueLifecycle(rawValue: lifecycleRaw) else {
        throw PlaybackManualQueueError.invalidEntry
      }
      let position = sqlite3_column_int64(statement, 2)
      guard position >= 0 else { throw PlaybackManualQueueError.invalidEntry }
      rows.append(PlaybackManualQueueEntry(entryID: entryID, itemID: itemID,
        position: position, addedAt: addedAt, lifecycle: lifecycle))
    }
  }

  private func queued<T: Sendable>(
    _ body: @escaping @Sendable (OpaquePointer) throws -> T
  ) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          let db = try self.openValidated()
          defer { sqlite3_close(db) }
          continuation.resume(returning: try body(db))
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func openValidated() throws -> OpaquePointer {
    let values = try? databaseURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values?.isRegularFile == true, values?.isSymbolicLink != true else {
      throw PlaybackManualQueueError.unavailable
    }
    var handle: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
    guard sqlite3_open_v2(databaseURL.path, &handle, flags, nil) == SQLITE_OK,
          let db = handle else {
      if let handle { sqlite3_close(handle) }
      throw PlaybackManualQueueError.unavailable
    }
    do {
      sqlite3_busy_timeout(db, 250)
      try execute(db, "PRAGMA foreign_keys = ON")
      guard try scalar(db, "PRAGMA foreign_keys") == 1 else {
        throw PlaybackManualQueueError.foreignKeysUnavailable
      }
      let version = try scalar(db, "PRAGMA user_version")
      guard version >= 3 else { throw PlaybackManualQueueError.schemaNotPrepared }
      guard version == 3 else { throw PlaybackManualQueueError.incompatibleSchema }
      try validateSchema(db)
      return db
    } catch {
      sqlite3_close(db)
      throw error
    }
  }

  private func validateSchema(_ db: OpaquePointer) throws {
    let columns = try query(db, "PRAGMA table_info(playback_queue)") { statement in
      (textColumn(statement, 1), textColumn(statement, 2)?.uppercased(),
       sqlite3_column_int(statement, 3), sqlite3_column_int(statement, 5))
    }
    guard columns.count == 4,
          columns[0] == ("id", "TEXT", 1, 1),
          columns[1] == ("itemId", "TEXT", 1, 0),
          columns[2] == ("position", "INTEGER", 1, 0),
          columns[3] == ("addedAt", "TEXT", 1, 0) else {
      throw PlaybackManualQueueError.incompatibleSchema
    }
    let libraryColumns = try strings(db, "PRAGMA table_info(library_items)", column: 1)
    guard libraryColumns.contains("id"), libraryColumns.contains("lifecycle") else {
      throw PlaybackManualQueueError.incompatibleSchema
    }
    let definition = try strings(db,
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'playback_queue'",
      column: 0).first?.lowercased().filter { !$0.isWhitespace }
    guard definition?.contains("check(position>=0)") == true else {
      throw PlaybackManualQueueError.incompatibleSchema
    }
    let foreignKeys = try query(db, "PRAGMA foreign_key_list(playback_queue)") { statement in
      (textColumn(statement, 2), textColumn(statement, 3),
       textColumn(statement, 4), textColumn(statement, 6))
    }
    guard foreignKeys.count == 1, let key = foreignKeys.first,
          key.0 == "library_items", key.1 == "itemId", key.2 == "id",
          key.3?.uppercased() == "CASCADE" else {
      throw PlaybackManualQueueError.incompatibleSchema
    }
    let indexes = try query(db, "PRAGMA index_list(playback_queue)") { statement in
      (textColumn(statement, 1), sqlite3_column_int(statement, 2))
    }
    guard indexes.contains(where: { $0.0 == "playback_queue_position" && $0.1 == 1 }),
          indexes.contains(where: { $0.0 == "playback_queue_by_item" && $0.1 == 0 }),
          try strings(db, "PRAGMA index_info(playback_queue_position)", column: 2) == ["position"],
          try strings(db, "PRAGMA index_info(playback_queue_by_item)", column: 2) ==
            ["itemId", "position"] else {
      throw PlaybackManualQueueError.incompatibleSchema
    }
    let violations = try query(db, "PRAGMA foreign_key_check(playback_queue)") { _ in true }
    guard violations.isEmpty else { throw PlaybackManualQueueError.invalidEntry }
  }

  private func query<T>(_ db: OpaquePointer, _ sql: String,
                        transform: (OpaquePointer) -> T) throws -> [T] {
    let statement = try prepare(db, sql)
    defer { sqlite3_finalize(statement) }
    var values: [T] = []
    while true {
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { return values }
      guard step == SQLITE_ROW else { throw sqliteError(db) }
      values.append(transform(statement))
    }
  }

  private func strings(_ db: OpaquePointer, _ sql: String, column: Int32) throws -> [String] {
    try query(db, sql) { textColumn($0, column) ?? "" }
  }

  private func scalar(_ db: OpaquePointer, _ sql: String) throws -> Int64 {
    let statement = try prepare(db, sql)
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { throw sqliteError(db) }
    return sqlite3_column_int64(statement, 0)
  }

  private func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else { throw sqliteError(db) }
    return statement
  }

  private func execute(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw sqliteError(db) }
  }

  private func bind(_ value: String, to statement: OpaquePointer, at index: Int32,
                    db: OpaquePointer) throws {
    guard sqlite3_bind_text(statement, index, value, -1, queueSQLiteTransient) == SQLITE_OK else {
      throw sqliteError(db)
    }
  }

  private func sqliteError(_ db: OpaquePointer) -> PlaybackManualQueueError {
    let code = sqlite3_errcode(db)
    if code == SQLITE_BUSY || code == SQLITE_LOCKED { return .busy }
    return .storageFailure
  }

  private func textColumn(_ statement: OpaquePointer, _ column: Int32) -> String? {
    guard let value = sqlite3_column_text(statement, column) else { return nil }
    return String(cString: value)
  }

  private static func canonicalID(_ value: String) -> Bool {
    guard let id = UUID(uuidString: value) else { return false }
    return id.uuidString.lowercased() == value
  }
}
