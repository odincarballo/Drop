import Foundation

struct DropPreparedLocalFile: Equatable, Sendable {
  let uri: String
  let title: String
  let mediaType: String
  let durationSeconds: Double
}

enum DropLocalImportFailure: String, Error, Sendable {
  case scopeDenied = "SCOPE_DENIED"
  case readFailed = "READ_FAILED"
  case invalidFile = "INVALID_FILE"
  case insufficientSpace = "INSUFFICIENT_SPACE"
  case pickerUnavailable = "PICKER_UNAVAILABLE"
  case busy = "IMPORT_BUSY"

  static func classified(_ error: Error) -> Self {
    if let failure = error as? Self { return failure }
    if let storage = error as? DropLibraryStorageError {
      return storage == .insufficientSpace ? .insufficientSpace : .invalidFile
    }
    if (error as? POSIXError)?.code == .ENOSPC { return .insufficientSpace }
    let systemError = error as NSError
    if systemError.domain == NSCocoaErrorDomain && systemError.code == NSFileWriteOutOfSpaceError {
      return .insufficientSpace
    }
    if systemError.domain == "AVFoundationErrorDomain" { return .invalidFile }
    return .readFailed
  }
}

enum DropLocalImportOutcome: Equatable, Sendable {
  case prepared(DropPreparedLocalFile)
  case cancelled
  case failed(DropLocalImportFailure)
}

struct DropLocalImportUpdate: Sendable {
  enum Phase: String, Sendable { case preparing, copying, validating, cancelling }
  let phase: Phase
  var copiedBytes: Int64? = nil
  var totalBytes: Int64? = nil
}

@MainActor
final class DropLocalImportOperation {
  typealias Progress = @Sendable (Int64, Int64) -> Void
  typealias Prepare = @Sendable (URL, @escaping Progress) async throws -> DropPreparedLocalFile
  private let prepare: Prepare
  private let discard: @MainActor (DropPreparedLocalFile) async -> Void
  private let onUpdate: (DropLocalImportUpdate) -> Void
  private var completion: ((DropLocalImportOutcome) -> Void)?
  private var worker: Task<DropPreparedLocalFile, Error>?
  private var observer: Task<Void, Never>?
  private var selected = false
  private var cancelling = false
  private var percentage = -1

  init(prepare: @escaping Prepare = { url, progress in
         try await DropLocalImportOperation.prepareAuthorized(from: url, progress: progress)
       },
       discard: @escaping @MainActor (DropPreparedLocalFile) async -> Void = { value in
         await DropLocalImportOperation.discardPrepared(value)
       },
       onUpdate: @escaping (DropLocalImportUpdate) -> Void,
       completion: @escaping (DropLocalImportOutcome) -> Void) {
    self.prepare = prepare
    self.discard = discard
    self.onUpdate = onUpdate
    self.completion = completion
  }

  func selected(_ urls: [URL]) {
    guard completion != nil, !selected, !cancelling else { return }
    selected = true
    guard urls.count == 1, let url = urls.first else {
      finish(urls.isEmpty ? .cancelled : .failed(.invalidFile))
      return
    }
    onUpdate(DropLocalImportUpdate(phase: .preparing))
    let prepare = prepare
    let progress: Progress = { [weak self] copied, total in
      Task { @MainActor in self?.acceptProgress(copied: copied, total: total) }
    }
    let task = Task.detached { try await prepare(url, progress) }
    worker = task
    observer = Task { [self] in
      let result = await task.result
      worker = nil
      if cancelling {
        if case let .success(value) = result { await discard(value) }
        finish(.cancelled)
      } else {
        switch result {
        case let .success(value): finish(.prepared(value))
        case .failure(is CancellationError): finish(.cancelled)
        case let .failure(error): finish(.failed(.classified(error)))
        }
      }
      observer = nil
    }
  }

  @discardableResult
  func cancel() -> Bool {
    guard completion != nil else { return false }
    if !selected { finish(.cancelled); return true }
    if !cancelling {
      cancelling = true
      onUpdate(DropLocalImportUpdate(phase: .cancelling))
      worker?.cancel()
    }
    return true
  }

  private func acceptProgress(copied: Int64, total: Int64) {
    guard completion != nil, !cancelling, total > 0, copied >= 0, copied <= total else { return }
    let next = Int(Double(copied) / Double(total) * 100)
    guard next > percentage else { return }
    percentage = next
    onUpdate(DropLocalImportUpdate(phase: copied == total ? .validating : .copying,
                                  copiedBytes: copied, totalBytes: total))
  }

  private func finish(_ result: DropLocalImportOutcome) {
    guard let callback = completion else { return }
    completion = nil
    callback(result)
  }

  nonisolated static func prepareAuthorized(
    from url: URL, progress: @escaping Progress = { _, _ in },
    startAccess: @Sendable (URL) -> Bool = { $0.startAccessingSecurityScopedResource() },
    stopAccess: @Sendable (URL) -> Void = { $0.stopAccessingSecurityScopedResource() },
    stage: Prepare = { source, report in
      let result = try await DropLibraryStorage().stageLocalFile(from: source, progress: report)
      return DropPreparedLocalFile(uri: result.uri, title: result.title,
        mediaType: result.mediaType, durationSeconds: result.durationSeconds)
    }
  ) async throws -> DropPreparedLocalFile {
    try Task.checkCancellation()
    guard url.isFileURL else { throw DropLocalImportFailure.invalidFile }
    guard startAccess(url) else { throw DropLocalImportFailure.scopeDenied }
    defer { stopAccess(url) }
    return try await stage(url, progress)
  }

  nonisolated private static func discardPrepared(_ value: DropPreparedLocalFile) async {
    await Task.detached {
      // This value came from our own staging. A failed unlink is left for startup cleanup.
      if let storage = try? DropLibraryStorage(),
         let source = try? storage.localImportIdentity(uri: value.uri) {
        try? storage.removeOwnedCache(relative: source.cacheRelativePath)
      }
    }.value
  }
}
