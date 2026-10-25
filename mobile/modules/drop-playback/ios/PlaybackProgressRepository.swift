import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct PlaybackRecord: Sendable {
  let id: String
  let relativeMediaPath: String
  let mediaType: String
  let sizeBytes: Int64
  let position: Double
  let completedAt: String?
  let title: String
  let relativeArtworkPath: String?

  init(id: String, relativeMediaPath: String, mediaType: String, sizeBytes: Int64,
       position: Double, completedAt: String?, title: String = "Drop",
       relativeArtworkPath: String? = nil) {
    self.id = id
    self.relativeMediaPath = relativeMediaPath
    self.mediaType = mediaType
    self.sizeBytes = sizeBytes
    self.position = position
    self.completedAt = completedAt
    self.title = title
    self.relativeArtworkPath = relativeArtworkPath
  }
}

enum PlaybackRepositoryError: Error, Sendable {
  case unavailable
  case busy
  case invalidRecord
}

protocol PlaybackProgressRepository: AnyObject, Sendable {
  func load(id: String) async throws -> PlaybackRecord
  func save(id: String, position: Double, completedAt: String?) async throws
}

// Expo SQLite owns the UI connection. This separate, short-lived connection only
// reads a ready row and writes its two playback columns. WAL permits concurrent
// readers; all writes here are serialized and SQLITE_BUSY is bounded.
final class SQLitePlaybackProgressRepository: PlaybackProgressRepository, @unchecked Sendable {
  private let url: URL
  private let queue = DispatchQueue(label: "com.drop.playback.progress")

  init(databaseURL: URL) { url = databaseURL }

  func load(id: String) async throws -> PlaybackRecord {
    try await queued { db in
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(db,
        "SELECT relativeMediaPath, mediaType, sizeBytes, playbackPositionSeconds, completedAt, title, relativeArtworkPath FROM library_items WHERE id = ? AND lifecycle = 'ready'",
        -1, &statement, nil) == SQLITE_OK else { throw PlaybackRepositoryError.unavailable }
      sqlite3_bind_text(statement, 1, id, -1, SQLITE_TRANSIENT)
      let step = sqlite3_step(statement)
      if step == SQLITE_BUSY || step == SQLITE_LOCKED { throw PlaybackRepositoryError.busy }
      guard step == SQLITE_ROW,
            let path = sqlite3_column_text(statement, 0),
            let type = sqlite3_column_text(statement, 1),
            let title = sqlite3_column_text(statement, 5) else {
        throw PlaybackRepositoryError.invalidRecord
      }
      let completed = sqlite3_column_text(statement, 4).map { String(cString: $0) }
      return PlaybackRecord(id: id, relativeMediaPath: String(cString: path),
        mediaType: String(cString: type), sizeBytes: sqlite3_column_int64(statement, 2),
        position: sqlite3_column_double(statement, 3), completedAt: completed,
        title: String(cString: title),
        relativeArtworkPath: sqlite3_column_text(statement, 6).map { String(cString: $0) })
    }
  }

  func save(id: String, position: Double, completedAt: String?) async throws {
    guard position.isFinite && position >= 0 else { throw PlaybackRepositoryError.invalidRecord }
    try await queued { db in
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(db,
        "UPDATE library_items SET playbackPositionSeconds = ?, completedAt = ? WHERE id = ? AND lifecycle = 'ready'",
        -1, &statement, nil) == SQLITE_OK else { throw PlaybackRepositoryError.unavailable }
      sqlite3_bind_double(statement, 1, position)
      if let completedAt {
        sqlite3_bind_text(statement, 2, completedAt, -1, SQLITE_TRANSIENT)
      } else {
        sqlite3_bind_null(statement, 2)
      }
      sqlite3_bind_text(statement, 3, id, -1, SQLITE_TRANSIENT)
      let step = sqlite3_step(statement)
      if step == SQLITE_BUSY || step == SQLITE_LOCKED { throw PlaybackRepositoryError.busy }
      guard step == SQLITE_DONE else { throw PlaybackRepositoryError.unavailable }
    }
  }

  private func queued<T: Sendable>(
    _ body: @escaping @Sendable (OpaquePointer) throws -> T
  ) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          var result: T?
          for attempt in 0..<3 {
            do {
              var db: OpaquePointer?
              guard sqlite3_open_v2(self.url.path, &db,
                SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db else {
                if let db { sqlite3_close(db) }
                throw PlaybackRepositoryError.unavailable
              }
              sqlite3_busy_timeout(db, 150)
              defer { sqlite3_close(db) }
              result = try body(db)
              break
            } catch PlaybackRepositoryError.busy where attempt < 2 {
              Thread.sleep(forTimeInterval: 0.05 * Double(attempt + 1))
            }
          }
          guard let result else { throw PlaybackRepositoryError.busy }
          continuation.resume(returning: result)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}
