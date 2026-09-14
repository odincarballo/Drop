import Foundation

private struct MDAudioDescriptor: Decodable {
  let url: String
  let headers: [String: String]
  let fileName: String
  let formatId: String
  let container: String
  let codec: String
  let bitrateKbps: Double?
  let expectedBytes: Int64?
  let estimatedBytes: Int64?
}

private struct MDAudioPreparationError: Decodable {
  let code: String
}

private struct MDAudioPreparationEnvelope: Decodable {
  let descriptor: MDAudioDescriptor?
  let error: MDAudioPreparationError?
}

final class MDAudioDownloadManager: NSObject, URLSessionDownloadDelegate {
  typealias EventSink = ([String: Any?]) -> Void

  private let lock = NSLock()
  private let emitEvent: EventSink
  private var activeJobID: String?
  private var workspaceURL: URL?
  private var task: URLSessionDownloadTask?
  private var session: URLSession?
  private var descriptor: MDAudioDescriptor?
  private var redirectCount = 0
  private var responseValidated = false
  private var forcedFailureCode: String?

  init(emitEvent: @escaping EventSink) {
    self.emitEvent = emitEvent
  }

  func start(analysisID: String, formatID: String) -> String? {
    lock.lock()
    guard activeJobID == nil else {
      lock.unlock()
      return nil
    }
    let jobID = UUID().uuidString
    activeJobID = jobID
    lock.unlock()
    emit(jobID: jobID, status: "PREPARING", formatID: formatID)
    MDPythonBridge.prepareAudioDownload(analysisID, formatId: formatID) { [weak self] raw in
      self?.prepared(jobID: jobID, raw: raw)
    }
    return jobID
  }

  func cancel() {
    lock.lock()
    guard let jobID = activeJobID else {
      lock.unlock()
      return
    }
    activeJobID = nil
    let activeTask = task
    let activeSession = session
    let directory = workspaceURL
    resetLocked()
    lock.unlock()
    MDPythonBridge.cancel()
    activeTask?.cancel()
    activeSession?.invalidateAndCancel()
    MDAudioDownloadPolicy.removeWorkspace(directory)
    emit(jobID: jobID, status: "CANCELLED")
  }

  private func prepared(jobID: String, raw: String) {
    lock.lock()
    let stillActive = activeJobID == jobID
    lock.unlock()
    guard stillActive else { return }
    guard
      raw.utf8.count <= 32 * 1024,
      let data = raw.data(using: .utf8),
      let envelope = try? JSONDecoder().decode(MDAudioPreparationEnvelope.self, from: data)
    else {
      fail(jobID: jobID, code: "AUDIO_PREPARATION_FAILED")
      return
    }
    if let code = envelope.error?.code {
      fail(jobID: jobID, code: code)
      return
    }
    guard let descriptor = envelope.descriptor else {
      fail(jobID: jobID, code: "AUDIO_PREPARATION_FAILED")
      return
    }
    do {
      guard descriptor.container == "m4a", !descriptor.formatId.isEmpty else {
        throw MDAudioDownloadFailure.code("AUDIO_FORMAT_NOT_SUPPORTED")
      }
      guard let url = URL(string: descriptor.url) else {
        throw MDAudioDownloadFailure.code("AUDIO_URL_INVALID")
      }
      try MDAudioDownloadPolicy.validateURL(url)
      let headers = try MDAudioDownloadPolicy.validateHeaders(descriptor.headers)
      if let expected = descriptor.expectedBytes {
        try MDAudioDownloadPolicy.validateExpectedLength(expected)
      }
      let directory = try MDAudioDownloadPolicy.workspace(for: jobID)
      var request = URLRequest(url: url)
      request.httpMethod = "GET"
      request.timeoutInterval = MDAudioDownloadPolicy.requestTimeoutSeconds
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      for (name, value) in headers {
        request.setValue(value, forHTTPHeaderField: name)
      }
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = MDAudioDownloadPolicy.requestTimeoutSeconds
      configuration.timeoutIntervalForResource = MDAudioDownloadPolicy.resourceTimeoutSeconds
      configuration.httpCookieStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.urlCache = nil
      configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      configuration.httpMaximumConnectionsPerHost = 1
      let queue = OperationQueue()
      queue.name = "MediaDrop.AudioDownload"
      queue.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
      let task = session.downloadTask(with: request)
      lock.lock()
      guard activeJobID == jobID else {
        lock.unlock()
        session.invalidateAndCancel()
        MDAudioDownloadPolicy.removeWorkspace(directory)
        return
      }
      self.workspaceURL = directory
      self.descriptor = descriptor
      self.session = session
      self.task = task
      redirectCount = 0
      responseValidated = false
      forcedFailureCode = nil
      lock.unlock()
      emit(
        jobID: jobID,
        status: "DOWNLOADING",
        formatID: descriptor.formatId,
        container: descriptor.container,
        codec: descriptor.codec,
        totalBytes: descriptor.expectedBytes ?? descriptor.estimatedBytes
      )
      task.resume()
    } catch let failure as MDAudioDownloadFailure {
      fail(jobID: jobID, code: failure.code)
    } catch {
      fail(jobID: jobID, code: "AUDIO_STORAGE_UNAVAILABLE")
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    lock.lock()
    redirectCount += 1
    let count = redirectCount
    lock.unlock()
    guard count <= MDAudioDownloadPolicy.maximumRedirects, let url = request.url else {
      setForcedFailure("AUDIO_REDIRECT_INVALID")
      completionHandler(nil)
      return
    }
    do {
      try MDAudioDownloadPolicy.validateURL(url)
      var sanitized = request
      sanitized.allHTTPHeaderFields = try MDAudioDownloadPolicy.validateHeaders(
        request.allHTTPHeaderFields ?? [:]
      )
      completionHandler(sanitized)
    } catch {
      setForcedFailure("AUDIO_REDIRECT_INVALID")
      completionHandler(nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard let jobID = currentJobID(for: downloadTask) else { return }
    do {
      if !responseValidated, let response = downloadTask.response as? HTTPURLResponse {
        try MDAudioDownloadPolicy.validateResponse(response)
        lock.lock()
        responseValidated = true
        lock.unlock()
      }
      try MDAudioDownloadPolicy.validateTransferredBytes(totalBytesWritten)
      let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil
      emit(
        jobID: jobID,
        status: "DOWNLOADING",
        formatID: descriptor?.formatId,
        container: descriptor?.container,
        codec: descriptor?.codec,
        bytesDownloaded: totalBytesWritten,
        totalBytes: total,
        progress: total.map { min(1, Double(totalBytesWritten) / Double($0)) }
      )
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
      downloadTask.cancel()
    } catch {
      setForcedFailure("AUDIO_DOWNLOAD_FAILED")
      downloadTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let jobID = currentJobID(for: downloadTask), let descriptor, let workspaceURL else {
      return
    }
    do {
      if let response = downloadTask.response as? HTTPURLResponse {
        try MDAudioDownloadPolicy.validateResponse(response)
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: location.path)
      let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
      guard size >= 0 else {
        throw MDAudioDownloadFailure.code("AUDIO_STORAGE_UNAVAILABLE")
      }
      try MDAudioDownloadPolicy.validateTransferredBytes(size)
      let fileName = MDAudioDownloadPolicy.safeFileName(descriptor.fileName)
      let finalURL = workspaceURL.appendingPathComponent(fileName, isDirectory: false)
      if FileManager.default.fileExists(atPath: finalURL.path) {
        try FileManager.default.removeItem(at: finalURL)
      }
      try FileManager.default.moveItem(at: location, to: finalURL)
      complete(
        jobID: jobID,
        fileURL: finalURL,
        size: size,
        descriptor: descriptor
      )
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
    } catch {
      setForcedFailure("AUDIO_STORAGE_UNAVAILABLE")
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    lock.lock()
    guard task === self.task, let jobID = activeJobID else {
      lock.unlock()
      return
    }
    let code = forcedFailureCode
    let completed = error == nil && activeJobID == nil
    lock.unlock()
    if completed { return }
    fail(
      jobID: jobID,
      code: code ?? ((error as? URLError)?.code == .timedOut ? "AUDIO_TIMEOUT" : "AUDIO_DOWNLOAD_FAILED")
    )
  }

  private func currentJobID(for candidate: URLSessionTask) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return candidate === task ? activeJobID : nil
  }

  private func setForcedFailure(_ code: String) {
    lock.lock()
    forcedFailureCode = code
    lock.unlock()
  }

  private func complete(
    jobID: String,
    fileURL: URL,
    size: Int64,
    descriptor: MDAudioDescriptor
  ) {
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      return
    }
    activeJobID = nil
    let activeSession = session
    resetLocked()
    lock.unlock()
    activeSession?.finishTasksAndInvalidate()
    emit(
      jobID: jobID,
      status: "COMPLETED",
      formatID: descriptor.formatId,
      container: descriptor.container,
      codec: descriptor.codec,
      bytesDownloaded: size,
      totalBytes: size,
      progress: 1,
      fileName: fileURL.lastPathComponent,
      fileSize: size,
      localUri: fileURL.absoluteString
    )
  }

  private func fail(jobID: String, code: String) {
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      return
    }
    activeJobID = nil
    let activeTask = task
    let activeSession = session
    let directory = workspaceURL
    resetLocked()
    lock.unlock()
    activeTask?.cancel()
    activeSession?.invalidateAndCancel()
    MDAudioDownloadPolicy.removeWorkspace(directory)
    emit(jobID: jobID, status: "FAILED", errorCode: code)
  }

  private func resetLocked() {
    task = nil
    session = nil
    descriptor = nil
    redirectCount = 0
    responseValidated = false
    forcedFailureCode = nil
    workspaceURL = nil
  }

  private func emit(
    jobID: String,
    status: String,
    formatID: String? = nil,
    container: String? = nil,
    codec: String? = nil,
    bytesDownloaded: Int64? = nil,
    totalBytes: Int64? = nil,
    progress: Double? = nil,
    fileName: String? = nil,
    fileSize: Int64? = nil,
    localUri: String? = nil,
    errorCode: String? = nil
  ) {
    var event: [String: Any?] = ["jobId": jobID, "status": status]
    event["formatId"] = formatID
    event["container"] = container
    event["codec"] = codec
    event["bytesDownloaded"] = bytesDownloaded
    event["totalBytes"] = totalBytes
    event["progress"] = progress
    event["fileName"] = fileName
    event["fileSize"] = fileSize
    event["localUri"] = localUri
    event["errorCode"] = errorCode
    DispatchQueue.main.async { [emitEvent] in emitEvent(event) }
  }
}
