import CryptoKit
import Foundation
import SQLite3

struct DropLocalArtworkPublication: Sendable {
  let relativePath: String
  let sizeBytes: Int64
  let token: String?
}

// Native-only, bounded image transfer. Only atomic publication uses a disk temporary.
actor DropLocalImportArtwork {
  typealias Factory = @Sendable () throws -> DropLibraryStorage
  typealias Capacity = @Sendable (URL) throws -> Int64?
  typealias Move = @Sendable (URL, URL) throws -> Void
  private struct Owned {
    let publication: DropLocalArtworkPublication
    let url: URL
    let digest: SHA256.Digest
  }
  private let storage: Factory
  private let capacity: Capacity
  private let move: Move
  private var pending: (id: String, jpeg: Data)?
  private var owned: [String: Owned] = [:]

  init(
    storage: @escaping Factory = { try DropLibraryStorage() },
    capacity: @escaping Capacity = {
      try $0.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        .volumeAvailableCapacityForImportantUsage
    },
    move: @escaping Move = { try FileManager.default.moveItem(at: $0, to: $1) }
  ) {
    self.storage = storage
    self.capacity = capacity
    self.move = move
  }

  func remember(id: String, jpeg: Data?) throws -> Bool {
    let id = try DropLibraryStorage.validatedID(id)
    pending = nil
    guard let jpeg, let normalized = DropLocalMetadataExtractor.normalizedJPEG(jpeg) else {
      return false
    }
    pending = (id, normalized)
    return true
  }

  func publish(id: String) throws -> DropLocalArtworkPublication? {
    let id = try DropLibraryStorage.validatedID(id)
    if let previous = owned[id] { return previous.publication }
    guard let value = pending, value.id == id else { return nil }
    pending = nil
    let storage = try storage()
    let path = "Artwork/\(id).jpg"
    if let (_, size) = try storage.managedArtwork(id: id) {
      return DropLocalArtworkPublication(relativePath: path, sizeBytes: size, token: nil)
    }
    let destination = storage.artwork.appendingPathComponent("\(id).jpg")
    // Even an invalid existing file is not ours to replace.
    guard try DropLibraryFileInspection.regularSize(destination) == nil else {
      throw DropLibraryStorageError.invalidImage
    }
    guard let free = try capacity(storage.artwork),
      free - Int64(value.jpeg.count * 2) >= max(1_073_741_824, free / 10)
    else {
      throw DropLibraryStorageError.insufficientSpace
    }
    let token = UUID().uuidString.lowercased()
    let temporary = storage.artwork.appendingPathComponent(".local-\(token).tmp")
    guard DropLibraryPaths.isUnredirected(temporary) else {
      throw DropLibraryStorageError.invalidManagedPath
    }
    defer { try? FileManager.default.removeItem(at: temporary) }
    try value.jpeg.write(to: temporary, options: .withoutOverwriting)
    try move(temporary, destination)  // Same directory, no replace: atomic publication.
    let publication = DropLocalArtworkPublication(
      relativePath: path, sizeBytes: Int64(value.jpeg.count), token: token)
    owned[id] = Owned(
      publication: publication, url: destination, digest: SHA256.hash(data: value.jpeg))
    return publication
  }

  func finish(id: String, token: String, keep: Bool) throws {
    let id = try DropLibraryStorage.validatedID(id)
    guard let value = owned[id], value.publication.token == token else { return }
    if keep {
      owned[id] = nil
      return
    }
    let storage = try storage()
    // Unknown or unavailable SQL state is never evidence that a file is unreferenced.
    guard try !isReferenced(value.publication.relativePath, root: storage.root) else {
      owned[id] = nil
      return
    }
    if let size = try DropLibraryFileInspection.regularSize(value.url) {
      guard size == value.publication.sizeBytes, size <= 2 * 1_048_576 else { return }
      let handle = try FileHandle(forReadingFrom: value.url)
      defer { try? handle.close() }
      let data = try handle.read(upToCount: 2 * 1_048_576 + 1) ?? Data()
      guard data.count == size, SHA256.hash(data: data) == value.digest else { return }
      try FileManager.default.removeItem(at: value.url)
    }
    owned[id] = nil
  }

  func discard(id: String) { if pending?.id == id { pending = nil } }

  private func isReferenced(_ relative: String, root: URL) throws -> Bool {
    let database = root.appendingPathComponent("library.sqlite")
    guard try DropLibraryFileInspection.regularSize(database) != nil else {
      throw DropLibraryStorageError.missingFile
    }
    var db: OpaquePointer?
    guard sqlite3_open_v2(database.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
      if let db { sqlite3_close(db) }
      throw DropLibraryStorageError.invalidSource
    }
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard
      sqlite3_prepare_v2(
        db, "SELECT 1 FROM library_items WHERE relativeArtworkPath = ? LIMIT 1", -1, &statement, nil
      ) == SQLITE_OK, let statement
    else {
      throw DropLibraryStorageError.invalidSource
    }
    defer { sqlite3_finalize(statement) }
    let bound = relative.withCString {
      sqlite3_bind_text(statement, 1, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }
    guard bound == SQLITE_OK else { throw DropLibraryStorageError.invalidSource }
    switch sqlite3_step(statement) {
    case SQLITE_ROW: return true
    case SQLITE_DONE: return false
    default: throw DropLibraryStorageError.invalidSource
    }
  }
}
