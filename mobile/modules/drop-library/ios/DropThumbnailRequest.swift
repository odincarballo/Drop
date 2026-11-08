import AVFoundation
import Foundation

// Lock protects terminal state and the single observer. No foreign code runs locked.
// @unchecked Sendable is confined to this audited lock-protected state.
final class DropThumbnailRequest: @unchecked Sendable {
  typealias Reply = @Sendable (Result<Data, Error>) -> Void
  private let lock = NSLock()
  private var observer: Reply?
  private var stored: Result<Data, Error>?
  private var finished = false
  private var registered = false
  private let stop: @Sendable () -> Void

  init(stop: @escaping @Sendable () -> Void) { self.stop = stop }
  var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return finished }

  func observe(_ reply: @escaping Reply) {
    lock.lock()
    precondition(!registered)
    registered = true
    let result = stored
    stored = nil
    if !finished { observer = reply }
    lock.unlock()
    if let result { reply(result) }
  }

  @discardableResult
  func finish(_ result: Result<Data, Error>) -> Bool {
    lock.lock()
    guard !finished else { lock.unlock(); return false }
    finished = true
    let reply = observer
    observer = nil
    if !registered { stored = result }
    lock.unlock()
    reply?(result)
    return true
  }

  func cancel() {
    if finish(.failure(CancellationError())) { stop() }
  }
}


// This queue confines all mutable generator state, including start/cancel ordering.
// The lock-protected request above owns completion; AVFoundation does not own it.
private final class DropThumbnailGenerator: @unchecked Sendable {
  private let queue = DispatchQueue(label: "com.drop.metadata.thumbnail")
  private let asset: AVURLAsset
  private let time: CMTime
  private var generator: AVAssetImageGenerator?
  private var cancelled = false

  init(asset: AVURLAsset, time: CMTime) { self.asset = asset; self.time = time }

  func start(_ reply: @escaping DropThumbnailRequest.Reply) {
    queue.async {
      guard !self.cancelled else { return }
      let generator = AVAssetImageGenerator(asset: self.asset)
      generator.maximumSize = CGSize(width: 512, height: 512)
      generator.appliesPreferredTrackTransform = true
      generator.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
      generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
      self.generator = generator
      generator.generateCGImageAsynchronously(for: self.time) { [weak self] image, _, error in
        guard let self else { return }
        self.queue.async {
          guard !self.cancelled else { return }
          self.generator = nil
          if let image, let data = DropLocalMetadataExtractor.jpeg(image) {
            reply(.success(data))
          } else {
            reply(.failure(error ?? ThumbnailFailure.unavailable))
          }
        }
      }
    }
  }

  func cancel() {
    queue.async {
      self.cancelled = true
      self.generator?.cancelAllCGImageGeneration()
      self.generator = nil
    }
  }

  enum ThumbnailFailure: Error { case unavailable }

  static func generate(asset: AVURLAsset, time: CMTime) async throws -> Data {
    let driver = DropThumbnailGenerator(asset: asset, time: time)
    let request = DropThumbnailRequest(stop: { driver.cancel() })
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      let data = try await withCheckedThrowingContinuation { continuation in
        request.observe { continuation.resume(with: $0) }
        if !request.isFinished {
          driver.start { request.finish($0) }
        }
      }
      try Task.checkCancellation()
      return data
    } onCancel: { request.cancel() }
  }
}

extension DropThumbnailRequest {
  static func image(asset: AVURLAsset, time: CMTime) async throws -> Data {
    try await DropThumbnailGenerator.generate(asset: asset, time: time)
  }
}
