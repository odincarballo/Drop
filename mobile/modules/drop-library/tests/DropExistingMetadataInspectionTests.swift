import CryptoKit
import Foundation

@main
struct DropExistingMetadataInspectionTests {
  static func main() async throws {
    let fixtures = URL(fileURLWithPath: CommandLine.arguments[1])
    let root = URL(fileURLWithPath: CommandLine.arguments[2])
    let support = root.appendingPathComponent("Support")
    let cache = root.appendingPathComponent("Cache")
    let storage = try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
    let inspect = DropExistingMetadataInspection(storage: {
      try DropLibraryStorage(supportDirectory: support, cacheDirectory: cache)
    })
    var failures = 0
    func check(_ value: Bool, _ label: String) {
      print("\(value ? "PASS":"FAIL") \(label)")
      if !value { failures += 1 }
    }
    var last: (id: String, path: String, size: Int64, duration: Double)?
    var request = 1
    for name in ["tagged.mp3", "tagged.m4a", "horizontal.mp4"] {
      let id = UUID().uuidString.lowercased()
      let ext = URL(fileURLWithPath: name).pathExtension
      let source =
        name == "tagged.m4a"
        ? URL(fileURLWithPath: CommandLine.arguments[3]) : fixtures.appendingPathComponent(name)
      let path = "ImportedMedia/\(id).\(ext)"
      let destination = storage.importedMedia.appendingPathComponent("\(id).\(ext)")
      try FileManager.default.copyItem(at: source, to: destination)
      let data = try Data(contentsOf: destination)
      let hash = SHA256.hash(data: data)
      let media = try await DropLocalMediaInspection.inspect(destination)
      last = (id, path, Int64(data.count), media.durationSeconds)
      let result = try await inspect.inspect(
        request: request, id: id, path: path, size: Int64(data.count),
        duration: media.durationSeconds)
      check(
        ext == "mp3" ? result.artist != nil : result.jpeg != nil,
        "\(name) existing managed extraction")
      check(
        SHA256.hash(data: try Data(contentsOf: destination)) == hash, "\(name) source unchanged")
      do {
        _ = try await inspect.inspect(
          request: request + 1, id: id, path: path, size: Int64(data.count), duration: 1)
        check(false, "duplicate proposal rejected")
      } catch { check(true, "duplicate proposal rejected") }
      await inspect.discard(request: request, id: id)
      request += 2
    }
    await inspect.cancel(request: 100)
    do {
      _ = try await inspect.inspect(
        request: 100, id: UUID().uuidString.lowercased(), path: "ImportedMedia/missing.mp3",
        size: 5, duration: 1)
      check(false, "pre-registration cancel retained")
    } catch { check(true, "pre-registration cancel retained") }
    do {
      _ = try await inspect.inspect(
        request: 101, id: UUID().uuidString.lowercased(), path: "Media/other.mp3", size: 5,
        duration: 1)
      check(false, "non-imported source rejected")
    } catch { check(true, "non-imported source rejected") }
    if let value = last {
      await inspect.discard(request: 102, id: value.id)
      do {
        _ = try await inspect.inspect(
          request: 102, id: value.id, path: value.path, size: value.size, duration: value.duration)
        check(false, "discard before registration invalidates late request")
        await inspect.discard(request: 102, id: value.id)
      } catch { check(true, "discard before registration invalidates late request") }
    }
    print("FAILURES \(failures)")
    if failures > 0 { exit(1) }
  }
}
