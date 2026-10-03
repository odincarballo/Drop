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
  private let makeSessionConfiguration: () -> URLSessionConfiguration
  private let validateTransferURL: (URL, MDLocalDownloadKind) throws -> Void
  private let availableStorage: () -> Int64?
  private var activeJobID: String?
  private var activeKind: MDLocalDownloadKind?
  private var workspaceURL: URL?
  private var task: URLSessionTask?
  private var session: URLSession?
  private var descriptor: MDAudioDescriptor?
  private var redirectCount = 0
  private var responseValidated = false
  private var forcedFailureCode: String?
  private var cancellationRequested = false
  private let videoChunkSize: Int64 = 256 * 1024
  private var usesRangeTransfer = false
  private var videoBytesPersisted: Int64 = 0
  private var videoRangeStart: Int64?
  private var videoRangeEnd: Int64?
  private var videoTotalBytes: Int64?
  private var videoPartialURL: URL?
  private var videoChunkBytesReceived: Int64 = 0
  private var videoContentRange: MDVideoContentRange?
  private var fullBodyFallback = false
  private var standaloneAudio = false
  private var expectedAudioDurationSeconds: Double?
  private var audioNormalizer: MDAVAudioNormalizer?
  private var rangeRequestIndex = 0
  private var rangeRetryCount = 0
  private var retryBudget = MDRangeRetryBudget()
  private var retryWorkItem: DispatchWorkItem?
  private var deadlineWorkItem: DispatchWorkItem?
  private var retryGeneration = 0
  private var resourceETag: String?
  private var lastResponseStatus: Int?
  private var lastRetryAfter: String?
  private var httpDiagnostics = MDHTTPTransferDiagnostics()
  private var analysisID = ""
  private var selectedFormatID = ""
  private var forbiddenAudioRefreshUsed = false
  private var refreshingForbiddenAudio = false
  private var audioRefreshGeneration = 0
  private var plannedCombinedAudioExact: Int64?
  private var plannedCombinedAudioApproximate: Int64?
  private var completedCombinedVideoBytes: Int64?
  private var isCombinedVideo = false

  private func maximumBytes(for kind: MDLocalDownloadKind) -> Int64 {
    kind == .audio ? MDDownloadSizePolicy.audioBytes :
      MDDownloadSizePolicy.videoMaximumBytes(height: descriptor?.height)
  }

  private func validateStorage(
    kind: MDLocalDownloadKind,
    height: Int?,
    exact: Int64?,
    approximate: Int64?
  ) throws {
    let sizeUnknown = (exact == nil && approximate == nil) ||
      (isCombinedVideo && plannedCombinedAudioExact == nil &&
        plannedCombinedAudioApproximate == nil)
    let planned = MDStorageBudget.plannedBytes(
      exact: exact, approximate: approximate,
      cap: kind == .audio ? MDDownloadSizePolicy.audioBytes :
        MDDownloadSizePolicy.videoMaximumBytes(height: height))
    do {
      if kind == .video, isCombinedVideo {
        let audio = MDStorageBudget.plannedBytes(
          exact: plannedCombinedAudioExact,
          approximate: plannedCombinedAudioApproximate,
          cap: MDDownloadSizePolicy.audioBytes)
        try MDStorageBudget.validate(mode: .combined, video: planned, audio: audio,
          available: availableStorage())
      } else if kind == .audio, let video = completedCombinedVideoBytes {
        try MDStorageBudget.validate(mode: .combinedAudio, video: video, audio: planned,
          available: availableStorage())
      } else {
        try MDStorageBudget.validate(
          mode: kind == .video ? .video : .audio,
          video: kind == .video ? planned : 0,
          audio: kind == .audio ? planned : 0,
          available: availableStorage())
      }
    } catch let failure as MDAudioDownloadFailure {
      if sizeUnknown && (failure.code == "LOCAL_STORAGE_INSUFFICIENT" ||
        failure.code == "LOCAL_STORAGE_CAPACITY_UNAVAILABLE") {
        throw MDAudioDownloadFailure.code("LOCAL_STORAGE_SIZE_UNKNOWN")
      }
      throw failure
    }
  }

  init(
    emitEvent: @escaping EventSink,
    makeSessionConfiguration: @escaping () -> URLSessionConfiguration = {
      URLSessionConfiguration.ephemeral
    },
    availableStorage: @escaping () -> Int64? = { MDStorageBudget.availableCapacity() },
    validateTransferURL: @escaping (URL, MDLocalDownloadKind) throws -> Void = {
      try MDAudioDownloadPolicy.validateURL($0, kind: $1)
    }
  ) {
    self.emitEvent = emitEvent
    self.makeSessionConfiguration = makeSessionConfiguration
    self.availableStorage = availableStorage
    self.validateTransferURL = validateTransferURL
  }

  var isActive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return activeJobID != nil
  }

  func start(
    analysisID: String, formatID: String, durationSeconds: Double,
    retryBudget: MDRangeRetryBudget? = nil
  ) -> String? {
    start(
      kind: .audio,
      analysisID: analysisID,
      formatID: formatID,
      useRanges: MDAudioDownloadPolicy.standaloneAudioUsesRanges,
      standaloneAudio: true,
      expectedAudioDurationSeconds: durationSeconds,
      retryBudget: retryBudget
    )
  }

  func startRangedAudio(
    analysisID: String, formatID: String, retryBudget: MDRangeRetryBudget? = nil,
    completedVideoBytes: Int64? = nil
  ) -> String? {
    start(kind: .audio, analysisID: analysisID, formatID: formatID, useRanges: true,
      standaloneAudio: false, expectedAudioDurationSeconds: nil, retryBudget: retryBudget,
      completedVideoBytes: completedVideoBytes)
  }

  func startVideo(
    analysisID: String, formatID: String, retryBudget: MDRangeRetryBudget? = nil,
    combinedAudioExact: Int64? = nil, combinedAudioApproximate: Int64? = nil,
    isCombinedVideo: Bool = false
  ) -> String? {
    start(kind: .video, analysisID: analysisID, formatID: formatID, useRanges: true,
      standaloneAudio: false, expectedAudioDurationSeconds: nil, retryBudget: retryBudget,
      combinedAudioExact: combinedAudioExact,
      combinedAudioApproximate: combinedAudioApproximate,
      isCombinedVideo: isCombinedVideo)
  }

  private func start(
    kind: MDLocalDownloadKind,
    analysisID: String,
    formatID: String,
    useRanges: Bool,
    standaloneAudio: Bool,
    expectedAudioDurationSeconds: Double?,
    retryBudget: MDRangeRetryBudget? = nil,
    combinedAudioExact: Int64? = nil,
    combinedAudioApproximate: Int64? = nil,
    completedVideoBytes: Int64? = nil,
    isCombinedVideo: Bool = false
  ) -> String? {
    lock.lock()
    guard activeJobID == nil else {
      lock.unlock()
      return nil
    }
    let jobID = UUID().uuidString
    activeJobID = jobID
    activeKind = kind
    usesRangeTransfer = useRanges
    self.standaloneAudio = standaloneAudio
    self.expectedAudioDurationSeconds = expectedAudioDurationSeconds
    plannedCombinedAudioExact = combinedAudioExact
    plannedCombinedAudioApproximate = combinedAudioApproximate
    completedCombinedVideoBytes = completedVideoBytes
    self.isCombinedVideo = isCombinedVideo
    self.retryBudget = retryBudget ?? MDRangeRetryBudget()
    self.analysisID = analysisID
    selectedFormatID = formatID
    lock.unlock()
    emit(jobID: jobID, kind: kind, status: "PREPARING", formatID: formatID)
    let completion: (String) -> Void = { [weak self] raw in
      self?.prepared(jobID: jobID, kind: kind, raw: raw, refreshGeneration: nil)
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
    guard let jobID = activeJobID, let kind = activeKind, !cancellationRequested else {
      lock.unlock()
      return
    }
    let activeTask = task
    let activeSession = session
    let activeNormalizer = audioNormalizer
    let directory = workspaceURL
    let waitingForRetry = retryWorkItem != nil
    if refreshingForbiddenAudio {
      httpDiagnostics.captureForbiddenAudioRefresh(.cancelled)
    }
    let diagnostics = httpDiagnostics.eventValue()
    if activeNormalizer != nil || (activeTask != nil && !waitingForRetry) {
      cancellationRequested = true
    } else {
      activeJobID = nil
      resetLocked()
    }
    lock.unlock()
    MDPythonBridge.cancel()
    activeNormalizer?.cancel()
    activeTask?.cancel()
    activeSession?.invalidateAndCancel()
    if activeNormalizer == nil && (activeTask == nil || waitingForRetry) {
      MDAudioDownloadPolicy.removeWorkspace(directory)
      emit(jobID: jobID, kind: kind, status: "CANCELLED", httpDiagnostics: diagnostics)
    }
  }

  private func prepared(
    jobID: String, kind: MDLocalDownloadKind, raw: String,
    refreshGeneration: Int?
  ) {
    lock.lock()
    let isRefresh = refreshGeneration != nil
    let stillActive = activeJobID == jobID && !cancellationRequested &&
      (isRefresh
        ? refreshingForbiddenAudio && audioRefreshGeneration == refreshGeneration
        : !refreshingForbiddenAudio)
    lock.unlock()
    guard stillActive else { return }
    if isRefresh && retryBudget.secondsRemaining.map({ $0 <= 0 }) == true {
      failRecoveryBudget(jobID: jobID, kind: kind)
      return
    }
    guard
      raw.utf8.count <= 32 * 1024,
      let data = raw.data(using: .utf8),
      let envelope = try? JSONDecoder().decode(MDAudioPreparationEnvelope.self, from: data)
    else {
      if isRefresh {
        lock.lock()
        httpDiagnostics.captureForbiddenAudioRefresh(.refreshFailed)
        lock.unlock()
      }
      fail(jobID: jobID, code: failureCode(kind, "AUDIO_PREPARATION_FAILED", "VIDEO_PREPARATION_FAILED"))
      return
    }
    if let code = envelope.error?.code {
      if isRefresh {
        lock.lock()
        httpDiagnostics.captureForbiddenAudioRefresh(
          ["AUDIO_TRACK_CHANGED", "AUDIO_TRACK_AMBIGUOUS", "FORMAT_NOT_AVAILABLE"]
            .contains(code) ? .identityRejected : .refreshFailed)
        lock.unlock()
      }
      fail(jobID: jobID, code: code)
      return
    }
    guard let descriptor = envelope.descriptor else {
      if isRefresh {
        lock.lock()
        httpDiagnostics.captureForbiddenAudioRefresh(.refreshFailed)
        lock.unlock()
      }
      fail(jobID: jobID, code: failureCode(kind, "AUDIO_PREPARATION_FAILED", "VIDEO_PREPARATION_FAILED"))
      return
    }
    do {
      if isRefresh {
        guard descriptor.formatId == selectedFormatID,
              descriptor.codec.lowercased().hasPrefix("mp4a.") ||
                descriptor.codec.lowercased() == "aac" else {
          lock.lock()
          httpDiagnostics.captureForbiddenAudioRefresh(.identityRejected)
          lock.unlock()
          throw MDAudioDownloadFailure.code("AUDIO_TRACK_CHANGED")
        }
        lock.lock()
        httpDiagnostics.captureForbiddenAudioRefresh(.identityConfirmed)
        lock.unlock()
      }
      guard descriptor.container == kind.container, !descriptor.formatId.isEmpty else {
        throw MDAudioDownloadFailure.code(
          failureCode(kind, "AUDIO_FORMAT_NOT_SUPPORTED", "VIDEO_FORMAT_NOT_SUPPORTED")
        )
      }
      guard let url = URL(string: descriptor.url) else {
        throw MDAudioDownloadFailure.code("AUDIO_URL_INVALID")
      }
      try validateTransferURL(url, kind)
      let headers = try MDAudioDownloadPolicy.validateHeaders(
        descriptor.headers,
        kind: kind
      )
      if let expected = descriptor.expectedBytes {
        try MDAudioDownloadPolicy.validateExpectedLength(
          expected,
          maximumBytes: kind == .audio ? MDDownloadSizePolicy.audioBytes :
            MDDownloadSizePolicy.videoMaximumBytes(height: descriptor.height)
        )
      }
      try validateStorage(kind: kind, height: descriptor.height,
        exact: descriptor.expectedBytes, approximate: descriptor.estimatedBytes)
      let directory = try MDAudioDownloadPolicy.workspace(for: jobID)
      var request = URLRequest(url: url)
      request.httpMethod = "GET"
      request.timeoutInterval = MDAudioDownloadPolicy.requestTimeoutSeconds
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      for (name, value) in headers {
        request.setValue(value, forHTTPHeaderField: name)
      }
      let configuration = makeSessionConfiguration()
      configuration.timeoutIntervalForRequest = MDAudioDownloadPolicy.requestTimeoutSeconds
      configuration.timeoutIntervalForResource = MDAudioDownloadPolicy.resourceTimeoutSeconds
      configuration.httpCookieStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.urlCache = nil
      configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      configuration.httpMaximumConnectionsPerHost = 1
      if usesRangeTransfer {
        configuration.httpAdditionalHeaders = ["Accept-Encoding": "identity"]
      }
      let queue = OperationQueue()
      queue.name = "MediaDrop.\(kind.rawValue.capitalized)Download"
      queue.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
      if usesRangeTransfer {
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue("bytes=0-\(videoChunkSize - 1)", forHTTPHeaderField: "Range")
      }
      let task: URLSessionTask = usesRangeTransfer
        ? session.dataTask(with: request)
        : session.downloadTask(with: request)
      let partialURL = directory.appendingPathComponent(
        kind == .video ? "video.part" : "audio.part", isDirectory: false)
      if usesRangeTransfer {
        if isRefresh {
          try MDAudioDownloadPolicy.truncateUnverifiedBytes(
            at: partialURL, verifiedOffset: 0)
        } else {
          FileManager.default.createFile(atPath: partialURL.path, contents: nil)
        }
      }
      lock.lock()
      guard activeJobID == jobID && !cancellationRequested &&
            (!isRefresh ||
              (refreshingForbiddenAudio && audioRefreshGeneration == refreshGeneration)) else {
        lock.unlock()
        session.invalidateAndCancel()
        MDAudioDownloadPolicy.removeWorkspace(directory)
        return
      }
      self.workspaceURL = directory
      self.descriptor = descriptor
      self.session = session
      self.task = task
      if usesRangeTransfer {
        videoPartialURL = partialURL
        videoBytesPersisted = 0
        videoRangeStart = 0
        videoRangeEnd = videoChunkSize - 1
        rangeRequestIndex = 1
        videoTotalBytes = nil
        videoChunkBytesReceived = 0
        videoContentRange = nil
        fullBodyFallback = false
        rangeRetryCount = 0
        resourceETag = nil
        lastResponseStatus = nil
        lastRetryAfter = nil
        if !isRefresh { httpDiagnostics = MDHTTPTransferDiagnostics() }
        httpDiagnostics.captureRequest(start: 0, end: videoChunkSize - 1)
      }
      if isRefresh {
        refreshingForbiddenAudio = false
        httpDiagnostics.captureForbiddenAudioRefresh(.restartedAtZero)
      }
      redirectCount = 0
      responseValidated = false
      forcedFailureCode = nil
      lock.unlock()
      armRecoveryDeadline(jobID: jobID)
      lock.lock()
      let expired = retryBudget.secondsRemaining.map { $0 <= 0 } ?? false
      lock.unlock()
      if expired {
        fail(jobID: jobID, code: failureCode(kind,
          "AUDIO_RECOVERY_BUDGET_EXHAUSTED", "VIDEO_RECOVERY_BUDGET_EXHAUSTED"))
        return
      }
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
      if isRefresh {
        lock.lock()
        if failure.code != "AUDIO_TRACK_CHANGED" {
          httpDiagnostics.captureForbiddenAudioRefresh(.refreshFailed)
        }
        lock.unlock()
      }
      fail(jobID: jobID, code: failure.code)
    } catch {
      if isRefresh {
        lock.lock()
        httpDiagnostics.captureForbiddenAudioRefresh(.refreshFailed)
        lock.unlock()
      }
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
    guard task === self.task, !cancellationRequested else {
      lock.unlock()
      completionHandler(nil)
      return
    }
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
      try validateTransferURL(url, kind)
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
      if usesRangeTransfer, let start = videoRangeStart, let end = videoRangeEnd {
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
    guard currentJobID(for: dataTask) != nil else {
      completionHandler(.cancel)
      return
    }
    guard
      usesRangeTransfer,
      let kind = currentKind(for: dataTask),
      let response = response as? HTTPURLResponse,
      let start = videoRangeStart,
      let end = videoRangeEnd
    else {
      setForcedFailure("VIDEO_RANGE_INVALID")
      completionHandler(.cancel)
      return
    }
    do {
      lock.lock()
      httpDiagnostics.captureResponse(response)
      lastResponseStatus = response.statusCode
      lastRetryAfter = response.statusCode == 503
        ? response.value(forHTTPHeaderField: "Retry-After") : nil
      lock.unlock()
      if response.statusCode == 200 {
        lock.lock()
        let persisted = videoBytesPersisted
        let retried = rangeRetryCount > 0
        lock.unlock()
        guard !retried else {
          throw MDAudioDownloadFailure.code(
            kind == .audio ? "AUDIO_RANGE_NOT_SUPPORTED" : "VIDEO_RANGE_NOT_SUPPORTED"
          )
        }
        let expectedLength = try MDAudioDownloadPolicy.validateFullBodyFallbackResponse(
          response,
          requestedStart: start,
          bytesAlreadyPersisted: persisted,
          kind: kind,
          maximumBytes: maximumBytes(for: kind)
        )
        if videoTotalBytes == nil {
          try validateStorage(kind: kind, height: descriptor?.height,
            exact: expectedLength, approximate: descriptor?.estimatedBytes)
        }
        lock.lock()
        videoTotalBytes = expectedLength
        videoContentRange = nil
        fullBodyFallback = true
        responseValidated = true
        lock.unlock()
      } else {
        let range = try MDAudioDownloadPolicy.validateRangeResponse(
          response,
          requestedStart: start,
          requestedEnd: end,
          kind: kind,
          maximumBytes: maximumBytes(for: kind)
        )
        if videoTotalBytes == nil {
          try validateStorage(kind: kind, height: descriptor?.height,
            exact: range.total, approximate: nil)
        }
        lock.lock()
        let previousTotal = videoTotalBytes
        let previousETag = resourceETag
        let persisted = videoBytesPersisted
        lock.unlock()
        try MDAudioDownloadPolicy.validateRangeIdentity(
          range, response: response, previousTotal: previousTotal,
          previousStrongETag: previousETag, kind: kind)
        lock.lock()
        if persisted == 0 && previousETag == nil {
          resourceETag = MDAudioDownloadPolicy.strongETag(
            response.value(forHTTPHeaderField: "ETag")
          )
        }
        videoTotalBytes = range.total
        videoContentRange = range
        fullBodyFallback = false
        responseValidated = true
        lock.unlock()
      }
      completionHandler(.allow)
    } catch let failure as MDAudioDownloadFailure {
      if kind == .audio {
        lock.lock()
        if standaloneAudio {
          httpDiagnostics.captureAudioHTTPFailure(
            response,
            rangeStart: start,
            rangeEnd: end,
            rangeIndex: rangeRequestIndex,
            bytesPersisted: videoBytesPersisted
          )
        }
        lock.unlock()
      }
      setForcedFailure(failure.code)
      completionHandler(.cancel)
    } catch {
      setForcedFailure(kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID")
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
      usesRangeTransfer,
      let kind = currentKind(for: dataTask),
      let partialURL = videoPartialURL
    else { return }
    do {
      lock.lock()
      let persisted = videoBytesPersisted
      let chunkReceived = videoChunkBytesReceived
      let total = videoTotalBytes
      let contentRange = videoContentRange
      lock.unlock()
      let cumulative = persisted + chunkReceived + Int64(data.count)
      if let contentRange,
         chunkReceived + Int64(data.count) > contentRange.end - contentRange.start + 1 {
        throw MDAudioDownloadFailure.code(
          kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
        )
      }
      try MDAudioDownloadPolicy.validateTransferredBytes(
        cumulative,
        maximumBytes: maximumBytes(for: kind)
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
        kind: kind,
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
      setForcedFailure(kind == .audio ? "AUDIO_STORAGE_UNAVAILABLE" : "VIDEO_STORAGE_UNAVAILABLE")
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
        maximumBytes: maximumBytes(for: kind)
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
    lock.lock()
    let isCancelling = cancellationRequested
    lock.unlock()
    if isCancelling { return }
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
        maximumBytes: maximumBytes(for: kind)
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
      completeOrNormalize(
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
    if finishCancellationIfNeeded(for: task) { return }
    lock.lock()
    guard task === self.task, let jobID = activeJobID, let kind = activeKind else {
      lock.unlock()
      return
    }
    let code = forcedFailureCode
    let completed = error == nil && activeJobID == nil
    let isRecoveryAttempt = rangeRetryCount > 0
    lock.unlock()
    if completed { return }
    if isRecoveryAttempt && retryBudget.secondsRemaining.map({ $0 <= 0 }) == true {
      failRecoveryBudget(jobID: jobID, kind: kind)
      return
    }
    if kind == .audio, usesRangeTransfer,
       (task.response as? HTTPURLResponse)?.statusCode == 403,
       code == "AUDIO_HTTP_FORBIDDEN" {
      if !handleForbiddenAudioResponse(jobID: jobID, task: task) {
        fail(jobID: jobID, code: "AUDIO_HTTP_FORBIDDEN")
      }
      return
    }
    if usesRangeTransfer {
      let response = task.response as? HTTPURLResponse
      lock.lock()
      let usedFallback = fullBodyFallback
      let shortRange = error == nil && code == nil && responseValidated &&
        !usedFallback && videoContentRange.map {
          videoChunkBytesReceived < $0.end - $0.start + 1
        } == true
      lock.unlock()
      if !usedFallback && (error != nil || shortRange ||
          MDAudioDownloadPolicy.retryableHTTPStatuses.contains(
            response?.statusCode ?? lastResponseStatus ?? 0)),
         scheduleRetryIfAllowed(jobID: jobID, kind: kind, task: task,
           error: error, shortRange: shortRange) {
        return
      }
    }
    if usesRangeTransfer, error == nil, code == nil {
      do {
        lock.lock()
        let usedFullBodyFallback = fullBodyFallback
        lock.unlock()
        if usedFullBodyFallback {
          try finishFullBodyDataTask(jobID: jobID, kind: kind)
        } else {
          try finishRangeDataTask(jobID: jobID, kind: kind)
        }
      } catch let failure as MDAudioDownloadFailure {
        fail(jobID: jobID, code: failure.code)
      } catch {
        fail(
          jobID: jobID,
          code: kind == .audio ? "AUDIO_STORAGE_UNAVAILABLE" : "VIDEO_STORAGE_UNAVAILABLE"
        )
      }
      _ = finishCancellationIfNeeded(for: task)
      return
    }
    if finishCancellationIfNeeded(for: task) { return }
    lock.lock()
    let response = task.response as? HTTPURLResponse
    let validatedRange = videoContentRange.map {
      "bytes \($0.start)-\($0.end)/\($0.total)"
    }
    let validatedLength = responseValidated
      ? response?.value(forHTTPHeaderField: "Content-Length") : nil
    httpDiagnostics.captureFailure(
      phase: kind.rawValue,
      category: terminalCategory(code: code,
        status: response?.statusCode ?? lastResponseStatus, error: error),
      transportCode: error, status: response?.statusCode ?? lastResponseStatus,
      start: videoRangeStart ?? 0, end: videoRangeEnd ?? 0,
      index: rangeRequestIndex, offset: videoBytesPersisted,
      attempt: rangeRetryCount + 1, globalRetries: retryBudget.retriesUsed,
      remainingSeconds: retryBudget.secondsRemaining,
      host: response?.url?.host ?? task.currentRequest?.url?.host,
      contentRange: validatedRange, contentLength: validatedLength
    )
    lock.unlock()
    fail(
      jobID: jobID,
      code: retryFailureCode(for: kind, error: error, fallback: code)
    )
    _ = finishCancellationIfNeeded(for: task)
  }

  // Only a terminal 403 for a YouTube audio range may enter this path. The
  // previous task has completed, and no byte from its URL survives the refresh.
  private func handleForbiddenAudioResponse(jobID: String, task oldTask: URLSessionTask) -> Bool {
    lock.lock()
    guard activeJobID == jobID, oldTask === task, !cancellationRequested,
          let response = oldTask.response as? HTTPURLResponse,
          response.statusCode == 403 else {
      lock.unlock()
      return false
    }
    if forbiddenAudioRefreshUsed {
      httpDiagnostics.captureForbiddenAudioRefresh(.second403)
      lock.unlock()
      return false
    }
    httpDiagnostics.captureForbiddenAudioRefresh(.first403)
    httpDiagnostics.captureFailure(
      phase: "audio", category: "forbidden", transportCode: nil,
      status: 403, start: videoRangeStart ?? 0, end: videoRangeEnd ?? 0,
      index: rangeRequestIndex, offset: videoBytesPersisted,
      attempt: rangeRetryCount + 1, globalRetries: retryBudget.retriesUsed,
      remainingSeconds: retryBudget.secondsRemaining,
      host: response.url?.host,
      contentRange: nil, contentLength: nil)
    guard retryBudget.reserveAudioForbiddenRefresh(),
          let remaining = retryBudget.secondsRemaining, remaining > 0 else {
      httpDiagnostics.captureForbiddenAudioRefresh(.budgetUnavailable)
      lock.unlock()
      fail(jobID: jobID, code: "AUDIO_HTTP_FORBIDDEN")
      return true
    }
    httpDiagnostics.captureForbiddenAudioRefresh(.budgetReserved)
    httpDiagnostics.captureFailure(
      phase: "audio", category: "forbidden", transportCode: nil,
      status: 403, start: videoRangeStart ?? 0, end: videoRangeEnd ?? 0,
      index: rangeRequestIndex, offset: videoBytesPersisted,
      attempt: rangeRetryCount + 1, globalRetries: retryBudget.retriesUsed,
      remainingSeconds: retryBudget.secondsRemaining,
      host: response.url?.host,
      contentRange: nil, contentLength: nil)
    httpDiagnostics.captureForbiddenAudioRefresh(.started)
    forbiddenAudioRefreshUsed = true
    refreshingForbiddenAudio = true
    audioRefreshGeneration += 1
    let generation = audioRefreshGeneration
    retryGeneration += 1
    let oldSession = session
    session = nil
    task = nil
    deadlineWorkItem?.cancel()
    deadlineWorkItem = nil
    let analysisID = self.analysisID
    let formatID = selectedFormatID
    lock.unlock()
    oldSession?.finishTasksAndInvalidate()
    armRecoveryDeadline(jobID: jobID)
    MDPythonBridge.prepareAudioDownload(
      analysisID, formatId: formatID, timeoutSeconds: remaining
    ) { [weak self] raw in
      self?.prepared(
        jobID: jobID, kind: .audio, raw: raw, refreshGeneration: generation)
    }
    return true
  }

  private func finishFullBodyDataTask(jobID: String, kind: MDLocalDownloadKind) throws {
    guard
      responseValidated,
      let descriptor,
      let workspaceURL,
      let partialURL = videoPartialURL
    else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    let received = videoBytesPersisted + videoChunkBytesReceived
    try MDAudioDownloadPolicy.validateTransferredBytes(
      received,
      maximumBytes: maximumBytes(for: kind)
    )
    if let expected = videoTotalBytes, received != expected {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    let fileName = MDAudioDownloadPolicy.safeFileName(
      descriptor.fileName,
      extension: kind.container
    )
    let finalURL = workspaceURL.appendingPathComponent(fileName, isDirectory: false)
    if FileManager.default.fileExists(atPath: finalURL.path) {
      try FileManager.default.removeItem(at: finalURL)
    }
    try FileManager.default.moveItem(at: partialURL, to: finalURL)
    completeOrNormalize(
      jobID: jobID,
      kind: kind,
      fileURL: finalURL,
      size: received,
      descriptor: descriptor
    )
  }

  private func finishRangeDataTask(jobID: String, kind: MDLocalDownloadKind) throws {
    guard
      responseValidated,
      let contentRange = videoContentRange,
      let descriptor,
      let workspaceURL,
      let partialURL = videoPartialURL
    else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    guard videoChunkBytesReceived == contentRange.end - contentRange.start + 1 else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    let persisted = videoBytesPersisted + videoChunkBytesReceived
    try MDAudioDownloadPolicy.validateTransferredBytes(
      persisted,
      maximumBytes: maximumBytes(for: kind)
    )
    lock.lock()
    videoBytesPersisted = persisted
    videoTotalBytes = contentRange.total
    lock.unlock()
    if persisted == contentRange.total {
      let fileName = MDAudioDownloadPolicy.safeFileName(
        descriptor.fileName,
        extension: kind.container
      )
      let finalURL = workspaceURL.appendingPathComponent(fileName, isDirectory: false)
      if FileManager.default.fileExists(atPath: finalURL.path) {
        try FileManager.default.removeItem(at: finalURL)
      }
      try FileManager.default.moveItem(at: partialURL, to: finalURL)
      completeOrNormalize(
        jobID: jobID,
        kind: kind,
        fileURL: finalURL,
        size: persisted,
        descriptor: descriptor
      )
      return
    }
    guard persisted < contentRange.total else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    try startNextRangeChunk(
      jobID: jobID,
      start: persisted,
      total: contentRange.total,
      descriptor: descriptor,
      kind: kind
    )
  }

  private func startNextRangeChunk(
    jobID: String,
    start: Int64,
    total: Int64?,
    descriptor: MDAudioDescriptor,
    kind: MDLocalDownloadKind,
    requestedEnd: Int64? = nil,
    isRetry: Bool = false
  ) throws {
    guard let session, let url = URL(string: descriptor.url) else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_URL_INVALID" : "VIDEO_URL_INVALID"
      )
    }
    guard let end = requestedEnd ?? total.map({ min($0 - 1, start + videoChunkSize - 1) }) else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = MDAudioDownloadPolicy.requestTimeoutSeconds
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    for (name, value) in try MDAudioDownloadPolicy.validateHeaders(
      descriptor.headers,
      kind: kind
    ) {
      request.setValue(value, forHTTPHeaderField: name)
    }
    request.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    let nextTask = session.dataTask(with: request)
    lock.lock()
    guard activeJobID == jobID, !cancellationRequested else {
      lock.unlock()
      nextTask.cancel()
      return
    }
    task = nextTask
    redirectCount = 0
    if !isRetry {
      deadlineWorkItem?.cancel()
      deadlineWorkItem = nil
      retryGeneration += 1
      rangeRequestIndex += 1
      rangeRetryCount = 0
    }
    videoRangeStart = start
    videoRangeEnd = end
    videoChunkBytesReceived = 0
    videoContentRange = nil
    responseValidated = false
    lastResponseStatus = nil
    lastRetryAfter = nil
    forcedFailureCode = nil
    retryWorkItem = nil
    lock.unlock()
    nextTask.resume()
  }

  private func scheduleRetryIfAllowed(
    jobID: String,
    kind: MDLocalDownloadKind,
    task candidate: URLSessionTask,
    error: Error?,
    shortRange: Bool
  ) -> Bool {
    lock.lock()
    guard candidate === task, !cancellationRequested,
          let descriptor, let partialURL = videoPartialURL,
          let start = videoRangeStart, let end = videoRangeEnd else {
      lock.unlock()
      return false
    }
    let response = candidate.response as? HTTPURLResponse
    let status = response?.statusCode ?? lastResponseStatus
    let retryableHTTP = status.map { MDAudioDownloadPolicy.retryableHTTPStatuses.contains($0) } == true
    let retryableTransport = error.map(MDAudioDownloadPolicy.isRetryableTransport) == true
    guard retryableHTTP || retryableTransport || shortRange else {
      lock.unlock()
      return false
    }
    let retryAfter = status == 503 ? lastRetryAfter : nil
    let budget = retryBudget
    let nextPerRangeRetry = rangeRetryCount + 1
    let persisted = videoBytesPersisted
    let total = videoTotalBytes
    let rangeIndex = rangeRequestIndex
    let responseRange = videoContentRange.map {
      "bytes \($0.start)-\($0.end)/\($0.total)"
    }
    let responseLength = responseValidated
      ? response?.value(forHTTPHeaderField: "Content-Length") : nil
    let responseHost = response?.url?.host ?? URL(string: descriptor.url)?.host
    lock.unlock()

    let delay: TimeInterval
    if let retryAfter {
      guard let parsed = MDAudioDownloadPolicy.retryAfterSeconds(retryAfter) else {
        lock.lock()
        if activeJobID == jobID && candidate === task {
          httpDiagnostics.captureFailure(
            phase: kind.rawValue, category: "server", transportCode: nil,
            status: status, start: start, end: end, index: rangeIndex,
            offset: persisted, attempt: nextPerRangeRetry,
            globalRetries: budget.retriesUsed,
            remainingSeconds: budget.secondsRemaining,
            host: responseHost, contentRange: responseRange,
            contentLength: responseLength
          )
        }
        lock.unlock()
        fail(jobID: jobID, code: failureCode(kind,
          "AUDIO_RETRY_AFTER_INVALID", "VIDEO_RETRY_AFTER_INVALID"))
        return true
      }
      delay = parsed
    } else {
      delay = nextPerRangeRetry == 1 ? 0.5 : 1.5
    }
    guard budget.reserve(perRangeRetries: rangeRetryCount, delay: delay) else {
      let remaining = budget.secondsRemaining
      let code: String
      if retryAfter != nil && remaining.map({ delay >= $0 }) == true {
        code = failureCode(kind, "AUDIO_RETRY_AFTER_TOO_LONG", "VIDEO_RETRY_AFTER_TOO_LONG")
      } else if remaining.map({ $0 <= 0 }) == true {
        code = failureCode(kind,
          "AUDIO_RECOVERY_BUDGET_EXHAUSTED", "VIDEO_RECOVERY_BUDGET_EXHAUSTED")
      } else {
        code = retryFailureCode(for: kind, error: error, fallback: forcedFailureCode,
          exhausted: true)
      }
      lock.lock()
      if activeJobID == jobID && candidate === task {
        httpDiagnostics.captureFailure(
          phase: kind.rawValue, category: retryCategory(status: status, error: error),
          transportCode: error, status: status, start: start, end: end,
          index: rangeIndex, offset: persisted, attempt: nextPerRangeRetry,
          globalRetries: budget.retriesUsed,
          remainingSeconds: budget.secondsRemaining,
          host: responseHost, contentRange: responseRange, contentLength: responseLength
        )
      }
      lock.unlock()
      fail(jobID: jobID, code: code)
      return true
    }

    do {
      try MDAudioDownloadPolicy.truncateUnverifiedBytes(
        at: partialURL, verifiedOffset: persisted)
    } catch {
      fail(jobID: jobID, code: failureCode(kind,
        "AUDIO_STORAGE_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE"))
      return true
    }
    lock.lock()
    guard activeJobID == jobID, candidate === task, !cancellationRequested else {
      lock.unlock()
      return true
    }
    rangeRetryCount = nextPerRangeRetry
    videoChunkBytesReceived = 0
    videoContentRange = nil
    responseValidated = false
    forcedFailureCode = nil
    httpDiagnostics.captureFailure(
      phase: kind.rawValue, category: retryCategory(status: status, error: error),
      transportCode: error, status: status, start: start, end: end,
      index: rangeIndex, offset: persisted, attempt: nextPerRangeRetry,
      globalRetries: budget.retriesUsed,
      remainingSeconds: budget.secondsRemaining,
      host: responseHost, contentRange: responseRange, contentLength: responseLength
    )
    retryGeneration += 1
    let generation = retryGeneration
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let valid = self.activeJobID == jobID && !self.cancellationRequested &&
        self.retryGeneration == generation
      self.lock.unlock()
      guard valid else { return }
      guard budget.secondsRemaining.map({ $0 > 0 }) == true else {
        self.failRecoveryBudget(jobID: jobID, kind: kind)
        return
      }
      do {
        try self.startNextRangeChunk(jobID: jobID, start: start, total: total,
          descriptor: descriptor, kind: kind, requestedEnd: end, isRetry: true)
      } catch let failure as MDAudioDownloadFailure {
        self.fail(jobID: jobID, code: failure.code)
      } catch {
        self.fail(jobID: jobID, code: self.failureCode(kind,
          "AUDIO_STORAGE_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE"))
      }
    }
    retryWorkItem = work
    lock.unlock()
    armRecoveryDeadline(jobID: jobID)
    emit(jobID: jobID, kind: kind, status: "RETRYING",
      bytesDownloaded: persisted, totalBytes: total,
      retryCategory: retryCategory(status: status, error: error),
      httpDiagnostics: httpDiagnostics.eventValue())
    DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    return true
  }

  private func armRecoveryDeadline(jobID: String) {
    lock.lock()
    guard activeJobID == jobID,
          let remaining = retryBudget.secondsRemaining, remaining > 0 else {
      lock.unlock()
      return
    }
    deadlineWorkItem?.cancel()
    let generation = retryGeneration
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let valid = self.activeJobID == jobID && !self.cancellationRequested &&
        self.retryGeneration == generation
      let activeTask = self.task
      let waiting = self.retryWorkItem != nil
      let refreshing = self.refreshingForbiddenAudio
      let kind = self.activeKind
      self.lock.unlock()
      guard valid, let kind else { return }
      if refreshing {
        MDPythonBridge.cancel()
        self.failRecoveryBudget(jobID: jobID, kind: kind)
      } else if waiting {
        self.failRecoveryBudget(jobID: jobID, kind: kind)
      } else {
        self.captureBudgetExhaustion(jobID: jobID, kind: kind)
        self.setForcedFailure(self.failureCode(kind,
          "AUDIO_RECOVERY_BUDGET_EXHAUSTED", "VIDEO_RECOVERY_BUDGET_EXHAUSTED"),
          forJobID: jobID)
        activeTask?.cancel()
      }
    }
    deadlineWorkItem = work
    lock.unlock()
    DispatchQueue.global().asyncAfter(deadline: .now() + remaining, execute: work)
  }

  private func retryCategory(status: Int?, error: Error?) -> String {
    if status.map({ MDAudioDownloadPolicy.retryableHTTPStatuses.contains($0) }) == true {
      return "server"
    }
    if (error as NSError?)?.domain == NSURLErrorDomain &&
      (error as NSError?)?.code == NSURLErrorTimedOut { return "timeout" }
    return "connection"
  }

  private func captureBudgetExhaustion(jobID: String, kind: MDLocalDownloadKind) {
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      return
    }
    let response = task?.response as? HTTPURLResponse
    let range = videoContentRange.map { "bytes \($0.start)-\($0.end)/\($0.total)" }
    httpDiagnostics.captureFailure(
      phase: kind.rawValue, category: "timeout", transportCode: nil,
      status: response?.statusCode ?? lastResponseStatus, start: videoRangeStart ?? 0,
      end: videoRangeEnd ?? 0, index: rangeRequestIndex,
      offset: videoBytesPersisted, attempt: rangeRetryCount + 1,
      globalRetries: retryBudget.retriesUsed, remainingSeconds: 0,
      host: response?.url?.host ?? task?.currentRequest?.url?.host,
      contentRange: range,
      contentLength: responseValidated ? response?.value(forHTTPHeaderField: "Content-Length") : nil
    )
    lock.unlock()
  }

  private func failRecoveryBudget(jobID: String, kind: MDLocalDownloadKind) {
    lock.lock()
    if activeJobID == jobID && refreshingForbiddenAudio {
      httpDiagnostics.captureForbiddenAudioRefresh(.timedOut)
    }
    lock.unlock()
    captureBudgetExhaustion(jobID: jobID, kind: kind)
    fail(jobID: jobID, code: failureCode(kind,
      "AUDIO_RECOVERY_BUDGET_EXHAUSTED", "VIDEO_RECOVERY_BUDGET_EXHAUSTED"))
  }

  private func terminalCategory(code: String?, status: Int?, error: Error?) -> String {
    switch status {
    case 403: return "forbidden"
    case 416: return "range"
    case 429: return "rate_limit"
    default: break
    }
    if code?.contains("DNS_INVALID") == true || code?.contains("URL_INVALID") == true {
      return "security"
    }
    if code?.contains("RANGE_INVALID") == true || code?.contains("MIME") == true {
      return "integrity"
    }
    let transport = error as NSError?
    if transport?.domain == NSURLErrorDomain {
      if transport?.code == NSURLErrorCannotFindHost { return "dns" }
      if [NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted]
        .contains(transport?.code ?? 0) { return "security" }
    }
    if status.map({ MDAudioDownloadPolicy.retryableHTTPStatuses.contains($0) }) == true {
      return "server"
    }
    if (error as NSError?)?.domain == NSURLErrorDomain &&
      (error as NSError?)?.code == NSURLErrorTimedOut { return "timeout" }
    if error.map(MDAudioDownloadPolicy.isRetryableTransport) == true { return "connection" }
    return "other"
  }

  private func retryFailureCode(
    for kind: MDLocalDownloadKind, error: Error?, fallback: String?, exhausted: Bool = false
  ) -> String {
    if let fallback, !exhausted { return fallback }
    let transport = error as NSError?
    if transport?.domain == NSURLErrorDomain {
      if transport?.code == NSURLErrorCannotFindHost {
        return failureCode(kind, "AUDIO_DNS_UNAVAILABLE", "VIDEO_DNS_UNAVAILABLE")
      }
      if [NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted]
        .contains(transport?.code ?? 0) {
        return failureCode(kind, "AUDIO_TLS_ERROR", "VIDEO_TLS_ERROR")
      }
    }
    if lastResponseStatus.map({ MDAudioDownloadPolicy.retryableHTTPStatuses.contains($0) }) == true {
      return failureCode(kind,
        exhausted ? "AUDIO_SERVER_RETRIES_EXHAUSTED" : "AUDIO_HTTP_ERROR",
        exhausted ? "VIDEO_SERVER_RETRIES_EXHAUSTED" : "VIDEO_HTTP_ERROR")
    }
    if (error as NSError?)?.domain == NSURLErrorDomain &&
      (error as NSError?)?.code == NSURLErrorTimedOut {
      return failureCode(kind,
        exhausted ? "AUDIO_TIMEOUT_RETRIES_EXHAUSTED" : "AUDIO_TIMEOUT",
        exhausted ? "VIDEO_TIMEOUT_RETRIES_EXHAUSTED" : "VIDEO_TIMEOUT")
    }
    return failureCode(kind,
      exhausted ? "AUDIO_CONNECTION_RETRIES_EXHAUSTED" : "AUDIO_DOWNLOAD_FAILED",
      exhausted ? "VIDEO_CONNECTION_RETRIES_EXHAUSTED" : "VIDEO_DOWNLOAD_FAILED")
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

  @discardableResult
  private func finishCancellationIfNeeded(for candidate: URLSessionTask) -> Bool {
    lock.lock()
    guard
      candidate === task,
      cancellationRequested,
      let jobID = activeJobID,
      let kind = activeKind
    else {
      lock.unlock()
      return false
    }
    let directory = workspaceURL
    let activeSession = session
    activeJobID = nil
    resetLocked()
    lock.unlock()
    activeSession?.finishTasksAndInvalidate()
    MDAudioDownloadPolicy.removeWorkspace(directory)
    emit(jobID: jobID, kind: kind, status: "CANCELLED")
    return true
  }

  private func setForcedFailure(_ code: String, forJobID jobID: String? = nil) {
    lock.lock()
    if jobID == nil || activeJobID == jobID { forcedFailureCode = code }
    lock.unlock()
  }

  private func completeOrNormalize(
    jobID: String,
    kind: MDLocalDownloadKind,
    fileURL: URL,
    size: Int64,
    descriptor: MDAudioDescriptor
  ) {
    lock.lock()
    guard activeJobID == jobID, !cancellationRequested else {
      lock.unlock()
      return
    }
    guard kind == .audio, standaloneAudio else {
      lock.unlock()
      complete(jobID: jobID, kind: kind, fileURL: fileURL, size: size, descriptor: descriptor)
      return
    }
    guard let duration = expectedAudioDurationSeconds else {
      lock.unlock()
      fail(jobID: jobID, code: "AUDIO_DURATION_INVALID")
      return
    }
    do {
      try MDStorageBudget.validate(mode: .audioNormalization, audio: size,
        available: availableStorage())
    } catch let failure as MDAudioDownloadFailure {
      lock.unlock()
      fail(jobID: jobID, code: failure.code)
      return
    } catch {
      lock.unlock()
      fail(jobID: jobID, code: "LOCAL_STORAGE_CAPACITY_UNAVAILABLE")
      return
    }
    let outputURL = fileURL.deletingLastPathComponent()
      .appendingPathComponent("normalized.m4a", isDirectory: false)
    let normalizer = MDAVAudioNormalizer()
    let activeSession = session
    deadlineWorkItem?.cancel()
    deadlineWorkItem = nil
    retryGeneration += 1
    task = nil
    session = nil
    audioNormalizer = normalizer
    normalizer.start(
      inputURL: fileURL,
      outputURL: outputURL,
      expectedDurationSeconds: duration
    ) { [weak self] result in
      self?.finishNormalization(
        jobID: jobID,
        sourceURL: fileURL,
        outputURL: outputURL,
        descriptor: descriptor,
        result: result
      )
    }
    lock.unlock()
    activeSession?.finishTasksAndInvalidate()
  }

  private func finishNormalization(
    jobID: String,
    sourceURL: URL,
    outputURL: URL,
    descriptor: MDAudioDescriptor,
    result: Result<MDAVAudioNormalizationResult, MDAudioNormalizationFailure>
  ) {
    lock.lock()
    guard activeJobID == jobID, audioNormalizer != nil else {
      lock.unlock()
      return
    }
    let directory = workspaceURL
    let diagnostics = httpDiagnostics.eventValue()
    if cancellationRequested {
      activeJobID = nil
      resetLocked()
      lock.unlock()
      MDAudioDownloadPolicy.removeWorkspace(directory)
      emit(jobID: jobID, kind: .audio, status: "CANCELLED")
      return
    }
    var finalSize: Int64?
    var errorCode: String?
    switch result {
    case .success(let normalized):
      do {
        try MDAudioDownloadPolicy.validateTransferredBytes(
          normalized.fileSize,
          maximumBytes: MDLocalDownloadKind.audio.maximumBytes
        )
        try FileManager.default.removeItem(at: sourceURL)
        try FileManager.default.moveItem(at: outputURL, to: sourceURL)
        finalSize = normalized.fileSize
      } catch let failure as MDAudioDownloadFailure {
        errorCode = failure.code
      } catch {
        errorCode = "AUDIO_STORAGE_UNAVAILABLE"
      }
    case .failure(let failure):
      errorCode = failure.code
    }
    activeJobID = nil
    resetLocked()
    lock.unlock()
    if let finalSize {
      emit(
        jobID: jobID,
        kind: .audio,
        status: "COMPLETED",
        formatID: descriptor.formatId,
        container: descriptor.container,
        codec: descriptor.codec,
        bytesDownloaded: finalSize,
        totalBytes: finalSize,
        progress: 1,
        fileName: sourceURL.lastPathComponent,
        fileSize: finalSize,
        localUri: sourceURL.absoluteString,
        httpDiagnostics: diagnostics
      )
    } else {
      MDAudioDownloadPolicy.removeWorkspace(directory)
      emit(
        jobID: jobID,
        kind: .audio,
        status: "FAILED",
        errorCode: errorCode ?? "AUDIO_NORMALIZATION_OUTPUT_INVALID",
        httpDiagnostics: diagnostics
      )
    }
  }

  private func complete(
    jobID: String,
    kind: MDLocalDownloadKind,
    fileURL: URL,
    size: Int64,
    descriptor: MDAudioDescriptor
  ) {
    lock.lock()
    guard activeJobID == jobID, !cancellationRequested else {
      lock.unlock()
      return
    }
    activeJobID = nil
    let activeSession = session
    let diagnostics = httpDiagnostics.eventValue()
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
      localUri: fileURL.absoluteString,
      httpDiagnostics: diagnostics
    )
  }

  private func fail(jobID: String, code: String) {
    lock.lock()
    guard activeJobID == jobID, let kind = activeKind, !cancellationRequested else {
      lock.unlock()
      return
    }
    activeJobID = nil
    let activeTask = task
    let activeSession = session
    let refreshing = refreshingForbiddenAudio
    let directory = workspaceURL
    let diagnostics = httpDiagnostics.eventValue()
    resetLocked()
    lock.unlock()
    activeTask?.cancel()
    activeSession?.invalidateAndCancel()
    if refreshing { MDPythonBridge.cancel() }
    MDAudioDownloadPolicy.removeWorkspace(directory)
    emit(
      jobID: jobID,
      kind: kind,
      status: "FAILED",
      errorCode: code,
      httpDiagnostics: diagnostics
    )
  }

  private func resetLocked() {
    retryWorkItem?.cancel()
    deadlineWorkItem?.cancel()
    retryWorkItem = nil
    deadlineWorkItem = nil
    retryGeneration += 1
    task = nil
    session = nil
    descriptor = nil
    redirectCount = 0
    responseValidated = false
    forcedFailureCode = nil
    cancellationRequested = false
    workspaceURL = nil
    activeKind = nil
    usesRangeTransfer = false
    videoBytesPersisted = 0
    videoRangeStart = nil
    videoRangeEnd = nil
    videoTotalBytes = nil
    videoPartialURL = nil
    videoChunkBytesReceived = 0
    videoContentRange = nil
    fullBodyFallback = false
    standaloneAudio = false
    expectedAudioDurationSeconds = nil
    audioNormalizer = nil
    rangeRequestIndex = 0
    rangeRetryCount = 0
    retryBudget = MDRangeRetryBudget()
    resourceETag = nil
    lastResponseStatus = nil
    lastRetryAfter = nil
    httpDiagnostics = MDHTTPTransferDiagnostics()
    analysisID = ""
    selectedFormatID = ""
    forbiddenAudioRefreshUsed = false
    refreshingForbiddenAudio = false
    audioRefreshGeneration += 1
    plannedCombinedAudioExact = nil
    plannedCombinedAudioApproximate = nil
    completedCombinedVideoBytes = nil
    isCombinedVideo = false
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
    errorCode: String? = nil,
    retryCategory: String? = nil,
    httpDiagnostics: [String: Any]? = nil
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
    event["retryCategory"] = retryCategory
    event["httpDiagnostics"] = httpDiagnostics
    DispatchQueue.main.async { [emitEvent] in emitEvent(event) }
  }
}
