import Foundation

actor DropExistingMetadataInspection {
  typealias Factory = @Sendable () throws -> DropLibraryStorage
  private let storageFactory: Factory
  init(storage: @escaping Factory = { try DropLibraryStorage() }) { self.storageFactory = storage }
  private let images = DropLocalImportArtwork()
  private var active: (request: Int, task: Task<DropLocalMetadata, Error>)?
  private var proposal: (request: Int, id: String)?
  private var cancelledThrough = 0

  func inspect(request: Int, id: String, path: String, size: Int64, duration: Double) async throws
    -> DropLocalMetadata
  {
    guard request > cancelledThrough, active == nil, proposal == nil else {
      throw CancellationError()
    }
    let factory = storageFactory
    let task = Task.detached {
      let storage = try factory()
      let validID = try DropLibraryStorage.validatedID(id)
      guard path.hasPrefix("ImportedMedia/\(validID)."),
        DropLibraryPaths.managedMediaFolder(path) == .imported,
        let (url, actual) = try storage.managedMedia(relative: path), actual == size,
        duration.isFinite, duration > 0
      else { throw DropLibraryStorageError.invalidSource }
      let root = storage.importedMedia
      return try await DropLocalImportEnrichment.shared.run {
        try await DropLocalMetadataExtractor(managedRoots: [root]).extract(
          url, validatedDuration: duration)
      }
    }
    active = (request, task)
    defer { if active?.request == request { active = nil } }
    let result = try await task.value
    guard request > cancelledThrough else { throw CancellationError() }
    _ = try await images.remember(id: id, jpeg: result.jpeg)
    guard request > cancelledThrough else {
      await images.discard(id: id)
      throw CancellationError()
    }
    proposal = (request, id)
    return result
  }
  func cancel(request: Int) async {
    cancelledThrough = max(cancelledThrough, request)
    if active?.request == request { active?.task.cancel() }
    if let value = proposal, value.request == request {
      proposal = nil
      await images.discard(id: value.id)
    }
  }
  func publish(request: Int, id: String) async throws -> DropLocalArtworkPublication? {
    guard request > cancelledThrough, proposal?.request == request, proposal?.id == id else {
      throw CancellationError()
    }
    return try await images.publish(id: id)
  }
  func finish(id: String, token: String, keep: Bool) async throws {
    try await images.finish(id: id, token: token, keep: keep)
  }
  func discard(request: Int, id: String) async {
    // Finalization also invalidates a request that has not registered yet.
    await cancel(request: request)
  }
}
