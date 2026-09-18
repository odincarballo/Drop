import Foundation

private struct MDAudioDescriptor: Decodable {
  let url: String
  let headers: [String: String]
  let fileName: String
  let formatId: String
  let container: String
  let codec: String
  let bitrateKbps: Double?
  let height: Int?
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

final class MDAudioDownloadManager: NSObject, URLSessionDownloadDelegate, URLSessionDataDelegate {
  typealias EventSink = ([String: Any?]) -> Void

  private let lock = NSLock()
  private let emitEvent: EventSink
  private var activeJobID: String?
  private var activeKind: MDLocalDownloadKind?
  private var workspaceURL: URL?
  private var task: URLSessionTask?
  private var session: URLSession?
  private var descriptor: MDAudioDescriptor?
  private var redirectCount = 0
  private var responseValidated = false
  private var forcedFailureCode: String?
  private let videoChunkSize: Int64 = 256 * 1024
  private var videoBytesPersisted: Int64 = 0
  private var videoRangeStart: Int64?
  private var videoRangeEnd: Int64?
  private var videoTotalBytes: Int64?
  private var videoPartialURL: URL?
  private var videoChunkBytesReceived: Int64 = 0
  private var videoContentRange: MDVideoContentRange?

  init(emitEvent: @escaping EventSink) {
    self.emitEvent = emitEvent
  }

  func start(analysisID: String, formatID: String) -> String? {
    start(kind: .audio, analysisID: analysisID, formatID: formatID)
  }

  func startVideo(analysisID: String, formatID: String) -> String? {
    start(kind: .video, analysisID: analysisID, formatID: formatID)
  }

  private func start(
    kind: MDLocalDownloadKind,
    analysisID: String,
    formatID: String
  ) -> String? {
    lock.lock()
    guard activeJobID == nil else {
      lock.unlock()
      return nil
    }
    let jobID = UUID().uuidString
    activeJobID = jobID
    activeKind = kind
    lock.unlock()
    emit(jobID: jobID, kind: kind, status: "PREPARING", formatID: formatID)
    let completion: (String) -> Void = { [weak self] raw in
      self?.prepared(jobID: jobID, kind: kind, raw: raw)
    }
    if kind == .audio {
      MDPythonBridge.prepareAudioDownload(
        analysisID,
        formatId: formatID,
        completion: completion
      )
    } else {
      MDPythonBridge.prepareVideoDownload(
        analysisID,
        formatId: formatID,
        completion: completion
      )
    }
    return jobID
  }

  func cancel() {
    lock.lock()
    guard let jobID = activeJobID, let kind = activeKind else {
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
    emit(jobID: jobID, kind: kind, status: "CANCELLED")
  }

  private func prepared(jobID: String, kind: MDLocalDownloadKind, raw: String) {
    lock.lock()
    let stillActive = activeJobID == jobID
    lock.unlock()
    guard stillActive else { return }
    guard
      raw.utf8.count <= 32 * 1024,
      let data = raw.data(using: .utf8),
      let envelope = try? JSONDecoder().decode(MDAudioPreparationEnvelope.self, from: data)
    else {
      fail(jobID: jobID, code: failureCode(kind, "AUDIO_PREPARATION_FAILED", "VIDEO_PREPARATION_FAILED"))
      return
    }
    if let code = envelope.error?.code {
      fail(jobID: jobID, code: code)
      return
    }
    guard let descriptor = envelope.descriptor else {
      fail(jobID: jobID, code: failureCode(kind, "AUDIO_PREPARATION_FAILED", "VIDEO_PREPARATION_FAILED"))
      return
    }
    do {
      guard descriptor.container == kind.container, !descriptor.formatId.isEmpty else {
        throw MDAudioDownloadFailure.code(
          failureCode(kind, "AUDIO_FORMAT_NOT_SUPPORTED", "VIDEO_FORMAT_NOT_SUPPORTED")
        )
      }
      guard let url = URL(string: descriptor.url) else {
        throw MDAudioDownloadFailure.code("AUDIO_URL_INVALID")
      }
      try MDAudioDownloadPolicy.validateURL(url, kind: kind)
      let headers = try MDAudioDownloadPolicy.validateHeaders(
        descriptor.headers,
        kind: kind
      )
      if let expected = descriptor.expectedBytes {
        try MDAudioDownloadPolicy.validateExpectedLength(
          expected,
          maximumBytes: kind.maximumBytes
        )
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
      if kind == .video {
        configuration.httpAdditionalHeaders = ["Accept-Encoding": "identity"]
      }
      let queue = OperationQueue()
      queue.name = "MediaDrop.\(kind.rawValue.capitalized)Download"
      queue.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
      if kind == .video {
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue("bytes=0-\(videoChunkSize - 1)", forHTTPHeaderField: "Range")
      }
      let task: URLSessionTask = kind == .video
        ? session.dataTask(with: request)
        : session.downloadTask(with: request)
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
      if kind == .video {
        let partialURL = directory.appendingPathComponent("video.part", isDirectory: false)
        FileManager.default.createFile(atPath: partialURL.path, contents: nil)
        videoPartialURL = partialURL
        videoBytesPersisted = 0
        videoRangeStart = 0
        videoRangeEnd = videoChunkSize - 1
        videoTotalBytes = nil
        videoChunkBytesReceived = 0
        videoContentRange = nil
      }
      redirectCount = 0
      responseValidated = false
      forcedFailureCode = nil
      lock.unlock()
      emit(
        jobID: jobID,
        kind: kind,
        status: "DOWNLOADING",
        formatID: descriptor.formatId,
        container: descriptor.container,
        codec: descriptor.codec,
        height: descriptor.height,
        totalBytes: descriptor.expectedBytes ?? descriptor.estimatedBytes
      )
      task.resume()
    } catch let failure as MDAudioDownloadFailure {
      fail(jobID: jobID, code: failure.code)
    } catch {
      fail(jobID: jobID, code: failureCode(kind, "AUDIO_STORAGE_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE"))
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
    let kind = activeKind
    lock.unlock()
    guard
      let kind,
      count <= MDAudioDownloadPolicy.maximumRedirects,
      let url = request.url
    else {
      setForcedFailure("LOCAL_REDIRECT_INVALID")
      completionHandler(nil)
      return
    }
    do {
      try MDAudioDownloadPolicy.validateURL(url, kind: kind)
      var sanitized = request
      var externalHeaders = request.allHTTPHeaderFields ?? [:]
      for key in Array(externalHeaders.keys) {
        if key.caseInsensitiveCompare("Range") == .orderedSame
          || key.caseInsensitiveCompare("Accept-Encoding") == .orderedSame {
          externalHeaders.removeValue(forKey: key)
        }
      }
      sanitized.allHTTPHeaderFields = try MDAudioDownloadPolicy.validateHeaders(
        externalHeaders,
        kind: kind
      )
      if kind == .video, let start = videoRangeStart, let end = videoRangeEnd {
        sanitized.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        sanitized.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
      }
      completionHandler(sanitized)
    } catch {
      setForcedFailure(
        failureCode(kind, "AUDIO_REDIRECT_INVALID", "VIDEO_REDIRECT_INVALID")
      )
      completionHandler(nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard
      currentKind(for: dataTask) == .video,
      let response = response as? HTTPURLResponse,
      let start = videoRangeStart,
      let end = videoRangeEnd
    else {
      setForcedFailure("VIDEO_RANGE_INVALID")
      completionHandler(.cancel)
      return
    }
    do {
      let range = try MDAudioDownloadPolicy.validateVideoRangeResponse(
        response,
        requestedStart: start,
        requestedEnd: end
      )
      lock.lock()
      videoTotalBytes = range.total
      videoContentRange = range
      responseValidated = true
      lock.unlock()
      completionHandler(.allow)
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
      completionHandler(.cancel)
    } catch {
      setForcedFailure("VIDEO_RANGE_INVALID")
      completionHandler(.cancel)
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    guard
      let jobID = currentJobID(for: dataTask),
      currentKind(for: dataTask) == .video,
      let partialURL = videoPartialURL
    else { return }
    do {
      lock.lock()
      let persisted = videoBytesPersisted
      let chunkReceived = videoChunkBytesReceived
      let total = videoTotalBytes
      lock.unlock()
      let cumulative = persisted + chunkReceived + Int64(data.count)
      try MDAudioDownloadPolicy.validateTransferredBytes(
        cumulative,
        maximumBytes: MDLocalDownloadKind.video.maximumBytes
      )
      let writer = try FileHandle(forWritingTo: partialURL)
      defer { try? writer.close() }
      try writer.seekToEnd()
      try writer.write(contentsOf: data)
      lock.lock()
      videoChunkBytesReceived += Int64(data.count)
      let received = videoBytesPersisted + videoChunkBytesReceived
      lock.unlock()
      emit(
        jobID: jobID,
        kind: .video,
        status: "DOWNLOADING",
        formatID: descriptor?.formatId,
        container: descriptor?.container,
        codec: descriptor?.codec,
        height: descriptor?.height,
        bytesDownloaded: received,
        totalBytes: total,
        progress: total.map { min(1, Double(received) / Double($0)) }
      )
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
      dataTask.cancel()
    } catch {
      setForcedFailure("VIDEO_STORAGE_UNAVAILABLE")
      dataTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard
      let jobID = currentJobID(for: downloadTask),
      let kind = currentKind(for: downloadTask),
      kind == .audio
    else { return }
    do {
      if !responseValidated, let response = downloadTask.response as? HTTPURLResponse {
        if kind == .video, let start = videoRangeStart, let end = videoRangeEnd {
          let range = try MDAudioDownloadPolicy.validateVideoRangeResponse(
            response,
            requestedStart: start,
            requestedEnd: end
          )
          lock.lock()
          videoTotalBytes = range.total
          lock.unlock()
        } else {
          try MDAudioDownloadPolicy.validateResponse(response, kind: kind)
        }
        lock.lock()
        responseValidated = true
        lock.unlock()
      }
      lock.lock()
      let persisted = kind == .video ? videoBytesPersisted : 0
      let knownVideoTotal = videoTotalBytes
      lock.unlock()
      let cumulativeBytes = persisted + totalBytesWritten
      try MDAudioDownloadPolicy.validateTransferredBytes(
        cumulativeBytes,
        maximumBytes: kind.maximumBytes
      )
      let total = kind == .video
        ? knownVideoTotal
        : (totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil)
      emit(
        jobID: jobID,
        kind: kind,
        status: "DOWNLOADING",
        formatID: descriptor?.formatId,
        container: descriptor?.container,
        codec: descriptor?.codec,
        height: descriptor?.height,
        bytesDownloaded: cumulativeBytes,
        totalBytes: total,
        progress: total.map { min(1, Double(cumulativeBytes) / Double($0)) }
      )
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
      downloadTask.cancel()
    } catch {
      setForcedFailure(failureCode(kind, "AUDIO_DOWNLOAD_FAILED", "VIDEO_DOWNLOAD_FAILED"))
      downloadTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard
      let jobID = currentJobID(for: downloadTask),
      let kind = currentKind(for: downloadTask),
      kind == .audio,
      let descriptor,
      let workspaceURL
    else {
      return
    }
    do {
      if let response = downloadTask.response as? HTTPURLResponse {
        try MDAudioDownloadPolicy.validateResponse(response, kind: kind)
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: location.path)
      let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
      guard size >= 0 else {
        throw MDAudioDownloadFailure.code(
          failureCode(kind, "AUDIO_STORAGE_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE")
        )
      }
      try MDAudioDownloadPolicy.validateTransferredBytes(
        size,
        maximumBytes: kind.maximumBytes
      )
      let fileName = MDAudioDownloadPolicy.safeFileName(
        descriptor.fileName,
        extension: kind.container
      )
      let finalURL = workspaceURL.appendingPathComponent(fileName, isDirectory: false)
      if FileManager.default.fileExists(atPath: finalURL.path) {
        try FileManager.default.removeItem(at: finalURL)
      }
      try FileManager.default.moveItem(at: location, to: finalURL)
      complete(
        jobID: jobID,
        kind: kind,
        fileURL: finalURL,
        size: size,
        descriptor: descriptor
      )
    } catch let failure as MDAudioDownloadFailure {
      setForcedFailure(failure.code)
    } catch {
      setForcedFailure(failureCode(kind, "AUDIO_STORAGE_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE"))
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    lock.lock()
    guard task === self.task, let jobID = activeJobID, let kind = activeKind else {
      lock.unlock()
      return
    }
    let code = forcedFailureCode
    let completed = error == nil && activeJobID == nil
    lock.unlock()
    if completed { return }
    if kind == .video, error == nil, code == nil {
      do {
        try finishVideoDataTask(jobID: jobID)
      } catch let failure as MDAudioDownloadFailure {
        fail(jobID: jobID, code: failure.code)
      } catch {
        fail(jobID: jobID, code: "VIDEO_STORAGE_UNAVAILABLE")
      }
      return
    }
    fail(
      jobID: jobID,
      code: code
        ?? ((error as? URLError)?.code == .timedOut
          ? failureCode(kind, "AUDIO_TIMEOUT", "VIDEO_TIMEOUT")
          : failureCode(kind, "AUDIO_DOWNLOAD_FAILED", "VIDEO_DOWNLOAD_FAILED"))
    )
  }

  private func finishVideoDataTask(jobID: String) throws {
    guard
      responseValidated,
      let contentRange = videoContentRange,
      let descriptor,
      let workspaceURL,
      let partialURL = videoPartialURL
    else {
      throw MDAudioDownloadFailure.code("VIDEO_RANGE_INVALID")
    }
    guard videoChunkBytesReceived == contentRange.end - contentRange.start + 1 else {
      throw MDAudioDownloadFailure.code("VIDEO_RANGE_INVALID")
    }
    let persisted = videoBytesPersisted + videoChunkBytesReceived
    try MDAudioDownloadPolicy.validateTransferredBytes(
      persisted,
      maximumBytes: MDLocalDownloadKind.video.maximumBytes
    )
    lock.lock()
    videoBytesPersisted = persisted
    videoTotalBytes = contentRange.total
    lock.unlock()
    if persisted == contentRange.total {
      let fileName = MDAudioDownloadPolicy.safeFileName(
        descriptor.fileName,
        extension: MDLocalDownloadKind.video.container
      )
      let finalURL = workspaceURL.appendingPathComponent(fileName, isDirectory: false)
      if FileManager.default.fileExists(atPath: finalURL.path) {
        try FileManager.default.removeItem(at: finalURL)
      }
      try FileManager.default.moveItem(at: partialURL, to: finalURL)
      complete(
        jobID: jobID,
        kind: .video,
        fileURL: finalURL,
        size: persisted,
        descriptor: descriptor
      )
      return
    }
    guard persisted < contentRange.total else {
      throw MDAudioDownloadFailure.code("VIDEO_RANGE_INVALID")
    }
    try startNextVideoChunk(
      jobID: jobID,
      start: persisted,
      total: contentRange.total,
      descriptor: descriptor
    )
  }

  private func startNextVideoChunk(
    jobID: String,
    start: Int64,
    total: Int64,
    descriptor: MDAudioDescriptor
  ) throws {
    guard let session, let url = URL(string: descriptor.url) else {
      throw MDAudioDownloadFailure.code("VIDEO_URL_INVALID")
    }
    let end = min(total - 1, start + videoChunkSize - 1)
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = MDAudioDownloadPolicy.requestTimeoutSeconds
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    for (name, value) in try MDAudioDownloadPolicy.validateHeaders(
      descriptor.headers,
      kind: .video
    ) {
      request.setValue(value, forHTTPHeaderField: name)
    }
    request.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    let nextTask = session.dataTask(with: request)
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      nextTask.cancel()
      return
    }
    task = nextTask
    videoRangeStart = start
    videoRangeEnd = end
    videoChunkBytesReceived = 0
    videoContentRange = nil
    responseValidated = false
    lock.unlock()
    nextTask.resume()
  }

  private func currentJobID(for candidate: URLSessionTask) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return candidate === task ? activeJobID : nil
  }

  private func currentKind(for candidate: URLSessionTask) -> MDLocalDownloadKind? {
    lock.lock()
    defer { lock.unlock() }
    return candidate === task ? activeKind : nil
  }

  private func setForcedFailure(_ code: String) {
    lock.lock()
    forcedFailureCode = code
    lock.unlock()
  }

  private func complete(
    jobID: String,
    kind: MDLocalDownloadKind,
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
      kind: kind,
      status: "COMPLETED",
      formatID: descriptor.formatId,
      container: descriptor.container,
      codec: descriptor.codec,
      height: descriptor.height,
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
    guard activeJobID == jobID, let kind = activeKind else {
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
    emit(jobID: jobID, kind: kind, status: "FAILED", errorCode: code)
  }

  private func resetLocked() {
    task = nil
    session = nil
    descriptor = nil
    redirectCount = 0
    responseValidated = false
    forcedFailureCode = nil
    workspaceURL = nil
    activeKind = nil
    videoBytesPersisted = 0
    videoRangeStart = nil
    videoRangeEnd = nil
    videoTotalBytes = nil
    videoPartialURL = nil
    videoChunkBytesReceived = 0
    videoContentRange = nil
  }

  private func failureCode(
    _ kind: MDLocalDownloadKind,
    _ audioCode: String,
    _ videoCode: String
  ) -> String {
    kind == .audio ? audioCode : videoCode
  }

  private func emit(
    jobID: String,
    kind: MDLocalDownloadKind,
    status: String,
    formatID: String? = nil,
    container: String? = nil,
    codec: String? = nil,
    height: Int? = nil,
    bytesDownloaded: Int64? = nil,
    totalBytes: Int64? = nil,
    progress: Double? = nil,
    fileName: String? = nil,
    fileSize: Int64? = nil,
    localUri: String? = nil,
    errorCode: String? = nil
  ) {
    var event: [String: Any?] = [
      "jobId": jobID,
      "mediaType": kind.rawValue,
      "status": status,
    ]
    event["formatId"] = formatID
    event["container"] = container
    event["codec"] = codec
    event["height"] = height
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
