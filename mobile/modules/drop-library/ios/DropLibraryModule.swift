import ExpoModulesCore
import Foundation

private final class LibraryOperationException: Exception, @unchecked Sendable {
  private let detail: String
  init(_ detail: String) {
    self.detail = detail
    super.init()
  }
  override var reason: String { detail }
}

private final class ArtworkTransfer: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  private var data = Data()
  private var finished = false
  private let completion: (Result<Data, Error>) -> Void
  private var session: URLSession?

  init(completion: @escaping (Result<Data, Error>) -> Void) { self.completion = completion }

  func start(_ url: URL) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.timeoutIntervalForRequest = 12
    configuration.timeoutIntervalForResource = 25
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    session.dataTask(with: url).resume()
  }

  private func finish(_ result: Result<Data, Error>) {
    guard !finished else { return }
    finished = true
    session?.invalidateAndCancel()
    session = nil
    completion(result)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest,
                  completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(request.url.map(DropArtworkPolicy.permitted) == true ? request : nil)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                  didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard let response = response as? HTTPURLResponse,
          response.url.map(DropArtworkPolicy.permitted) == true,
          DropArtworkPolicy.permittedResponse(status: response.statusCode,
            mime: response.mimeType, expectedBytes: response.expectedContentLength) else {
      completionHandler(.cancel)
      finish(.failure(DropLibraryStorageError.invalidImage))
      return
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    guard DropArtworkPolicy.mayAppend(current: data.count, incoming: chunk.count) else {
      dataTask.cancel()
      finish(.failure(DropLibraryStorageError.invalidImage))
      return
    }
    data.append(chunk)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  didCompleteWithError error: Error?) {
    if let error { finish(.failure(error)) }
    else { finish(.success(data)) }
  }
}

public final class DropLibraryModule: Module {
  private var artworkTransfers: [String: ArtworkTransfer] = [:]
  private let artworkLock = NSLock()
  private let localArtwork = DropLocalImportArtwork()
  @MainActor private var localImportPicker: DropLocalImportPicker?

  public func definition() -> ModuleDefinition {
    Name("DropLibrary")
    Events("onLocalImportProgress")

    OnDestroy {
      Task { @MainActor [self] in localImportPicker?.cancel() }
    }

    AsyncFunction("pickLocalFile") { (requestID: Int, promise: Promise) in
      Task { @MainActor [self] in
        guard requestID > 0, localImportPicker == nil else {
          promise.resolve(["status": "failed", "code": DropLocalImportFailure.busy.rawValue])
          return
        }
        guard let presenter = appContext?.utilities?.currentViewController() else {
          promise.resolve(["status": "failed", "code": DropLocalImportFailure.pickerUnavailable.rawValue])
          return
        }
        let picker = DropLocalImportPicker(requestID: requestID, onUpdate: { [weak self] update in
          var event: [String: Any] = ["requestId": requestID, "phase": update.phase.rawValue]
          if let copied = update.copiedBytes, let total = update.totalBytes {
            event["copiedBytes"] = copied
            event["totalBytes"] = total
          }
          self?.sendEvent("onLocalImportProgress", event)
        }, completion: { [weak self] result in
          if self?.localImportPicker?.requestID == requestID { self?.localImportPicker = nil }
          switch result {
          case let .prepared(value):
            Task { [weak self] in
              if let self, let identity = try? DropLibraryStorage().localImportIdentity(uri: value.uri) {
                _ = try? await localArtwork.remember(id: identity.id, jpeg: value.localArtwork)
              }
              var descriptor: [String: Any] = ["status": "prepared", "uri": value.uri, "title": value.title,
                "mediaType": value.mediaType, "durationSeconds": value.durationSeconds]
              if let artist = value.artist { descriptor["artist"] = artist }
              if let album = value.album { descriptor["album"] = album }
              if let genre = value.genre { descriptor["genre"] = genre }
              if let year = value.year { descriptor["year"] = year }
              promise.resolve(descriptor)
            }
          case .cancelled: promise.resolve(["status": "cancelled"])
          case let .failed(error): promise.resolve(["status": "failed", "code": error.rawValue])
          }
        })
        localImportPicker = picker
        do { try picker.present(from: presenter) }
        catch {
          localImportPicker = nil
          promise.resolve(["status": "failed", "code": DropLocalImportFailure.pickerUnavailable.rawValue])
        }
      }
    }

    AsyncFunction("cancelLocalFileImport") { (requestID: Int, promise: Promise) in
      Task { @MainActor [self] in
        guard let picker = localImportPicker, picker.requestID == requestID else {
          promise.resolve(false)
          return
        }
        promise.resolve(picker.cancel())
      }
    }

    AsyncFunction("normalizeCollectionName") { (raw: String) -> [String: String] in
      do {
        let result = try DropCollectionNamePolicy.normalize(raw)
        return ["name": result.name, "normalizedName": result.normalizedName]
      } catch let error as DropCollectionNameError {
        return ["error": error.rawValue]
      } catch {
        return ["error": "invalid"]
      }
    }

    Function("newCollectionId") { () -> String in
      DropCollectionNamePolicy.newID()
    }

    Function("newQueueEntryId") { () -> String in
      UUID().uuidString.lowercased()
    }

    AsyncFunction("prepare") { () throws -> [String: String] in
      let storage = try DropLibraryStorage()
      let root = try DropLibraryDatabase.prepare(
        canonicalRoot: storage.root,
        legacyRoot: DropLibraryDatabase.legacyRoot(for: storage.root))
      // Expo SQLite parses this argument with URL(string:). A raw filesystem path
      // containing a space is interpreted as a non-file URL and becomes literal %20.
      return ["databaseDirectoryURL": root.absoluteString]
    }

    AsyncFunction("localImportIdentity") { (uri: String) throws -> [String: String] in
      let source = try DropLibraryStorage().localImportIdentity(uri: uri)
      return ["id": source.id, "cacheRelativePath": source.cacheRelativePath,
              "relativeMediaPath": source.relativeMediaPath]
    }

    AsyncFunction("inspectSource") { (uri: String, origin: String) throws -> [String: Any] in
      let source = try DropLibraryStorage().inspectSource(uri: uri, origin: origin)
      return ["id": source.id, "cacheRelativePath": source.cacheRelativePath,
              "extension": source.ext, "sizeBytes": source.size,
              "relativeMediaPath": source.relativeMediaPath]
    }

    AsyncFunction("movePrepared") {
      (relative: String, id: String, ext: String, origin: String, size: Int, path: String) throws -> [String: Any] in
      let (destination, url, actualSize) = try DropLibraryStorage().moveFromCache(
        relative: relative, id: id, ext: ext, origin: origin, expectedSize: Int64(size), expectedPath: path)
      return ["relativeMediaPath": destination, "uri": url.absoluteString, "sizeBytes": actualSize]
    }

    AsyncFunction("confirmImported") {
      (relative: String, id: String, size: Int, mediaType: String) async throws -> [String: Any] in
      let metadata = try await DropLibraryStorage().confirmImported(
        relative: relative, id: id, size: Int64(size), mediaType: mediaType)
      return ["mediaType": metadata.mediaType, "durationSeconds": metadata.durationSeconds]
    }

    AsyncFunction("cleanupImportStaging") { (protected: [String]) throws in
      try DropLibraryStorage().cleanupImportStaging(protected: protected)
    }

    AsyncFunction("statPreparedSource") { (relative: String) throws -> [String: Any] in
      guard let (_, size) = try DropLibraryStorage().preparedSource(relative: relative) else {
        return ["exists": false]
      }
      return ["exists": true, "sizeBytes": size]
    }

    AsyncFunction("statMedia") { (relative: String) throws -> [String: Any] in
      let storage = try DropLibraryStorage()
      guard let (url, size) = try storage.managedMedia(relative: relative) else {
        return ["exists": false]
      }
      return ["exists": true, "uri": url.absoluteString, "sizeBytes": size]
    }

    AsyncFunction("statArtwork") { (id: String) throws -> [String: Any] in
      let storage = try DropLibraryStorage()
      guard let (url, size) = try storage.managedArtwork(id: id) else {
        return ["exists": false]
      }
      return ["exists": true, "uri": url.absoluteString, "sizeBytes": size]
    }

    AsyncFunction("listMedia") { () throws -> [String] in
      try DropLibraryStorage().mediaFiles()
    }

    AsyncFunction("listArtwork") { () throws -> [String] in
      try DropLibraryStorage().artworkFiles()
    }

    AsyncFunction("removeMedia") { (relative: String) throws in
      try DropLibraryStorage().removeMedia(relative: relative)
    }

    AsyncFunction("removeOwnedCache") { (relative: String) throws in
      try DropLibraryStorage().removeOwnedCache(relative: relative)
    }

    AsyncFunction("removeArtwork") { (id: String) throws in
      try DropLibraryStorage().removeArtwork(id: id)
    }

    AsyncFunction("publishLocalArtwork") { (id: String, promise: Promise) in
      Task { [self] in
        do {
          guard let value = try await localArtwork.publish(id: id) else { promise.resolve(nil); return }
          var descriptor: [String: Any] = ["relativePath": value.relativePath, "sizeBytes": value.sizeBytes]
          if let token = value.token { descriptor["token"] = token }
          promise.resolve(descriptor)
        } catch { promise.reject(LibraryOperationException("Local artwork unavailable")) }
      }
    }

    AsyncFunction("finishLocalArtwork") { (id: String, token: String, keep: Bool, promise: Promise) in
      Task { [self] in
        do { try await localArtwork.finish(id: id, token: token, keep: keep); promise.resolve(nil) }
        catch { promise.reject(LibraryOperationException("Local artwork reconciliation deferred")) }
      }
    }

    AsyncFunction("discardLocalArtwork") { (id: String, promise: Promise) in
      Task { [self] in await localArtwork.discard(id: id); promise.resolve(nil) }
    }

    AsyncFunction("saveArtwork") { (raw: String, id: String, promise: Promise) in
      guard let url = URL(string: raw), DropArtworkPolicy.permitted(url),
            (try? DropLibraryStorage.validatedID(id)) != nil else {
        promise.reject(LibraryOperationException("Invalid artwork source"))
        return
      }
      let key = UUID().uuidString
      let transfer = ArtworkTransfer { [weak self] result in
        defer {
          self?.artworkLock.lock()
          self?.artworkTransfers.removeValue(forKey: key)
          self?.artworkLock.unlock()
        }
        do {
          let data = try result.get()
          let (file, size) = try DropLibraryStorage().saveJPEG(data, id: id)
          promise.resolve(["uri": file.absoluteString, "sizeBytes": size])
        } catch {
          promise.reject(LibraryOperationException("Artwork unavailable"))
        }
      }
      artworkLock.lock()
      artworkTransfers[key] = transfer
      artworkLock.unlock()
      transfer.start(url)
    }
  }
}
