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

  public func definition() -> ModuleDefinition {
    Name("DropLibrary")

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

    AsyncFunction("inspectSource") { (uri: String) throws -> [String: Any] in
      let storage = try DropLibraryStorage()
      let (relative, ext, size) = try storage.relativeCachePath(for: uri)
      return ["id": UUID().uuidString.lowercased(), "cacheRelativePath": relative,
              "extension": ext, "sizeBytes": size]
    }

    AsyncFunction("movePrepared") { (relative: String, id: String, ext: String) throws -> [String: Any] in
      let storage = try DropLibraryStorage()
      let (url, size) = try storage.moveFromCache(relative: relative, id: id, ext: ext)
      return ["relativeMediaPath": "Media/\(url.lastPathComponent)",
              "uri": url.absoluteString, "sizeBytes": size]
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
