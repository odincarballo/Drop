import Foundation
import ImageIO
import SQLite3
import UniformTypeIdentifiers

@main
struct DropLocalImportArtworkTests {
  static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    let support = root.appendingPathComponent("Support")
    let cache = root.appendingPathComponent("Cache")
    let storage = try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
    try sql(
      storage.root.appendingPathComponent("library.sqlite"),
      "CREATE TABLE library_items(id TEXT PRIMARY KEY, relativeArtworkPath TEXT)")
    let factory: DropLocalImportArtwork.Factory = {
      try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
    }
    let store = DropLocalImportArtwork(storage: factory, capacity: { _ in 10_000_000_000 })
    let a = "00000000-0000-0000-0000-000000000001"
    let b = "00000000-0000-0000-0000-000000000002"
    let c = "00000000-0000-0000-0000-000000000003"
    let image = try jpeg()
    var failures = 0
    func check(_ ok: Bool, _ label: String) {
      print("\(ok ? "PASS":"FAIL") \(label)")
      if !ok { failures += 1 }
    }
    check(try await store.remember(id: a, jpeg: image), "accept valid native JPEG")
    let published = try await store.publish(id: a)
    check(
      published?.token != nil && published?.relativePath == "Artwork/\(a).jpg",
      "publication has managed path and ownership token")
    if let p = published, let token = p.token {
      check(try await store.publish(id: a)?.token == token, "duplicate publish reuses operation")
      try await store.finish(id: a, token: token, keep: false)
      check(
        try storage.managedArtwork(id: a) == nil,
        "SQL failure compensates only new unreferenced JPEG")
    }
    try image.write(to: storage.artwork.appendingPathComponent("\(b).jpg"))
    _ = try await store.remember(id: b, jpeg: image)
    let previous = try await store.publish(id: b)
    check(
      try previous?.token == nil
        && (Data(contentsOf: storage.artwork.appendingPathComponent("\(b).jpg"))) == image,
      "preexisting artwork not overwritten or owned")
    _ = try await store.remember(id: c, jpeg: image)
    if let p = try await store.publish(id: c), let token = p.token {
      try sql(
        storage.root.appendingPathComponent("library.sqlite"),
        "INSERT INTO library_items VALUES('another','\(p.relativePath)')")
      try await store.finish(id: c, token: token, keep: false)
      check(
        try storage.managedArtwork(id: c) != nil, "referenced artwork never removed by compensation"
      )
    } else {
      check(false, "reference protection publication")
    }
    check(!(try await store.remember(id: a, jpeg: Data([1, 2, 3]))), "corrupt image omitted")
    check(
      !(try await store.remember(id: a, jpeg: Data(count: 2 * 1_048_576 + 1))),
      "excessive image omitted")
    let failed = DropLocalImportArtwork(
      storage: factory, capacity: { _ in 10_000_000_000 },
      move: { _, _ in throw CocoaError(.fileWriteUnknown) })
    _ = try await failed.remember(id: a, jpeg: image)
    do {
      _ = try await failed.publish(id: a)
      check(false, "forced move fails")
    } catch { check(true, "forced move fails") }
    check(
      try storage.managedArtwork(id: a) == nil
        && !FileManager.default.contentsOfDirectory(atPath: storage.artwork.path).contains(where: {
          $0.hasSuffix(".tmp")
        }), "controlled publication failure cleans own temporary")
    let low = DropLocalImportArtwork(storage: factory, capacity: { _ in 0 })
    _ = try await low.remember(id: a, jpeg: image)
    do {
      _ = try await low.publish(id: a)
      check(false, "low capacity rejects optional image")
    } catch { check(true, "low capacity rejects optional image") }
    let discarded = DropLocalImportArtwork(storage: factory)
    _ = try await discarded.remember(id: a, jpeg: image)
    await discarded.discard(id: a)
    check(
      try await discarded.publish(id: a) == nil, "cancel before publication discards native bytes")
    // Acknowledgment, wrong ownership and changed contents cannot authorize removal.
    let kept = DropLocalImportArtwork(storage: factory, capacity: { _ in 10_000_000_000 })
    _ = try await kept.remember(id: a, jpeg: image)
    if let p = try await kept.publish(id: a), let token = p.token {
      try await kept.finish(id: a, token: "wrong-token", keep: false)
      check(try storage.managedArtwork(id: a) != nil, "wrong token cannot delete publication")
      try await kept.finish(id: a, token: token, keep: true)
      try await kept.finish(id: a, token: token, keep: false)
      check(
        try storage.managedArtwork(id: a) != nil,
        "successful acknowledgment cannot be compensated later")
    } else {
      check(false, "successful ownership acknowledgment")
    }
    let d = "00000000-0000-0000-0000-000000000004"
    let changed = DropLocalImportArtwork(storage: factory, capacity: { _ in 10_000_000_000 })
    _ = try await changed.remember(id: d, jpeg: image)
    if let p = try await changed.publish(id: d), let token = p.token {
      let file = storage.artwork.appendingPathComponent("\(d).jpg")
      try Data([7, 8, 9]).write(to: file)
      try await changed.finish(id: d, token: token, keep: false)
      check(
        try Data(contentsOf: file) == Data([7, 8, 9]),
        "changed file is not owned by obsolete image digest")
    } else {
      check(false, "changed file preservation")
    }
    let unknown = DropLocalImportArtwork(storage: factory, capacity: { _ in 10_000_000_000 })
    let f = "00000000-0000-0000-0000-000000000005"
    _ = try await unknown.remember(id: f, jpeg: image)
    if let p = try await unknown.publish(id: f), let token = p.token {
      try sql(
        storage.root.appendingPathComponent("library.sqlite"),
        "ALTER TABLE library_items RENAME TO unrelated")
      do {
        try await unknown.finish(id: f, token: token, keep: false)
        check(false, "unknown reference schema refuses removal")
      } catch { check(true, "unknown reference schema refuses removal") }
      check(
        try storage.managedArtwork(id: f) != nil, "ambiguous database retains recoverable image")
    } else {
      check(false, "unknown SQL protection")
    }
    print("FAILURES \(failures)")
    if failures > 0 { exit(1) }
  }
  static func sql(_ url: URL, _ text: String) throws {
    var db: OpaquePointer?
    guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else {
      throw CocoaError(.fileReadUnknown)
    }
    defer { sqlite3_close(db) }
    guard sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK else {
      throw CocoaError(.fileWriteUnknown)
    }
  }
  static func jpeg() throws -> Data {
    let ctx = CGContext(
      data: nil, width: 30, height: 20, bitsPerComponent: 8, bytesPerRow: 120,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    let data = NSMutableData()
    let d = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(d, ctx.makeImage()!, nil)
    guard CGImageDestinationFinalize(d) else { throw CocoaError(.fileWriteUnknown) }
    return data as Data
  }
}
