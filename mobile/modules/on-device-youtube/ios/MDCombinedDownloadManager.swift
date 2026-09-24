import Foundation

final class MDCombinedDownloadManager {
  typealias EventSink = ([String: Any?]) -> Void

  private enum Phase {
    case video
    case audio
    case muxing
  }

  private let lock = NSLock()
  private let stateQueue = DispatchQueue(label: "MediaDrop.CombinedFileLifecycle")
  private let emitEvent: EventSink
  private lazy var transfer = MDAudioDownloadManager { [weak self] event in
    self?.handleTransferEvent(event)
  }
  private var activeJobID: String?
  private var activeTransferJobID: String?
  private var phase: Phase?
  private var analysisID = ""
  private var videoFormatID = ""
  private var audioFormatID = ""
  private var expectedDurationSeconds = 0.0
  private var workspaceURL: URL?
  private var videoURL: URL?
  private var audioURL: URL?
  private var videoFileName = "YouTube video.mp4"
  private var videoHeight: Int?
  private var videoCodec: String?
  private var audioCodec: String?
  private var videoHTTPDiagnostics: [String: Any]?
  private var muxer: MDAVMuxer?
  private var cancellationRequested = false

  init(emitEvent: @escaping EventSink) {
    self.emitEvent = emitEvent
  }

  var isActive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return activeJobID != nil
  }

  func start(
    analysisID: String,
    videoFormatID: String,
    audioFormatID: String,
    expectedDurationSeconds: Double
  ) -> String? {
    lock.lock()
    guard activeJobID == nil else {
      lock.unlock()
      return nil
    }
    let jobID = UUID().uuidString
    var createdWorkspace: URL?
    do {
      let workspace = try MDAudioDownloadPolicy.workspace(for: jobID)
      createdWorkspace = workspace
      _ = try MDAVMuxPolicy.validatedDuration(expectedDurationSeconds)
      activeJobID = jobID
      phase = .video
      self.analysisID = analysisID
      self.videoFormatID = videoFormatID
      self.audioFormatID = audioFormatID
      self.expectedDurationSeconds = expectedDurationSeconds
      workspaceURL = workspace
      lock.unlock()
      emit(jobID: jobID, status: "PREPARING")
      guard let transferJobID = transfer.startVideo(
        analysisID: analysisID, formatID: videoFormatID
      ) else {
        fail(jobID: jobID, code: "COMBINED_DOWNLOAD_BUSY")
        return nil
      }
      lock.lock()
      if activeJobID == jobID { activeTransferJobID = transferJobID }
      lock.unlock()
      return jobID
    } catch let failure as MDAVMuxFailure {
      lock.unlock()
      MDAudioDownloadPolicy.removeWorkspace(createdWorkspace)
      emit(jobID: jobID, status: "FAILED", errorCode: failure.code)
      return nil
    } catch {
      lock.unlock()
      MDAudioDownloadPolicy.removeWorkspace(createdWorkspace)
      emit(jobID: jobID, status: "FAILED", errorCode: "COMBINED_STORAGE_UNAVAILABLE")
      return nil
    }
  }

  func cancel() {
    lock.lock()
    guard activeJobID != nil, !cancellationRequested else {
      lock.unlock()
      return
    }
    cancellationRequested = true
    lock.unlock()
    stateQueue.async { [weak self] in self?.performCancel() }
  }

  private func performCancel() {
    lock.lock()
    guard let jobID = activeJobID, cancellationRequested else {
      lock.unlock()
      return
    }
    let currentPhase = phase
    let activeMuxer = muxer
    lock.unlock()
    if currentPhase == .muxing {
      if let activeMuxer { activeMuxer.cancel() }
      else { finishCancelled(jobID: jobID) }
    } else if transfer.isActive {
      transfer.cancel()
    } else {
      finishCancelled(jobID: jobID)
    }
  }

  private func handleTransferEvent(_ event: [String: Any?]) {
    stateQueue.async { [weak self] in self?.processTransferEvent(event) }
  }

  private func processTransferEvent(_ event: [String: Any?]) {
    lock.lock()
    let jobID = activeJobID
    let currentPhase = phase
    let transferJobID = activeTransferJobID
    let isCancelling = cancellationRequested
    lock.unlock()
    guard let status = event["status"] as? String else { return }
    guard let jobID, let phase = currentPhase,
          let eventTransferJobID = event["jobId"] as? String,
          eventTransferJobID == transferJobID else {
      if status == "COMPLETED" { cleanupLateCompletedTransfer(event) }
      return
    }
    if isCancelling {
      if status == "COMPLETED" { cleanupLateCompletedTransfer(event) }
      if status == "COMPLETED" || status == "FAILED" || status == "CANCELLED" {
        finishCancelled(jobID: jobID)
      }
      return
    }
    if phase == .video, let diagnostics = event["httpDiagnostics"] as? [String: Any] {
      lock.lock()
      videoHTTPDiagnostics = diagnostics
      lock.unlock()
    }
    if status == "PREPARING" {
      emit(jobID: jobID, status: "PREPARING")
      return
    }
    if status == "DOWNLOADING" {
      emit(
        jobID: jobID,
        status: phase == .video ? "DOWNLOADING_VIDEO" : "DOWNLOADING_AUDIO",
        bytesDownloaded: event["bytesDownloaded"] as? Int64,
        totalBytes: event["totalBytes"] as? Int64,
        progress: event["progress"] as? Double
      )
      return
    }
    if status == "FAILED" {
      fail(
        jobID: jobID,
        code: event["errorCode"] as? String ?? "COMBINED_DOWNLOAD_FAILED",
        diagnostics: event["httpDiagnostics"] as? [String: Any]
      )
      return
    }
    if status == "CANCELLED" {
      cancel()
      return
    }
    guard status == "COMPLETED", let rawURI = event["localUri"] as? String else { return }
    do {
      let stored = try storeCompletedTransfer(rawURI: rawURI, phase: phase)
      if phase == .video {
        lock.lock()
        videoURL = stored
        videoFileName = event["fileName"] as? String ?? videoFileName
        videoHeight = event["height"] as? Int
        videoCodec = event["codec"] as? String
        self.phase = .audio
        let analysisID = self.analysisID
        let audioFormatID = self.audioFormatID
        lock.unlock()
        guard let transferJobID = transfer.startRangedAudio(
          analysisID: analysisID, formatID: audioFormatID
        ) else {
          fail(jobID: jobID, code: "COMBINED_DOWNLOAD_BUSY")
          return
        }
        lock.lock()
        if activeJobID == jobID { activeTransferJobID = transferJobID }
        lock.unlock()
      } else {
        lock.lock()
        audioURL = stored
        audioCodec = event["codec"] as? String
        self.phase = .muxing
        lock.unlock()
        startMux(jobID: jobID)
      }
    } catch {
      cleanupLateCompletedTransfer(event)
      fail(jobID: jobID, code: "COMBINED_STORAGE_UNAVAILABLE")
    }
  }

  private func cleanupLateCompletedTransfer(_ event: [String: Any?]) {
    guard let rawURI = event["localUri"] as? String,
          let source = URL(string: rawURI), source.isFileURL else { return }
    let directory = source.deletingLastPathComponent()
    guard UUID(uuidString: directory.lastPathComponent) != nil,
          directory.deletingLastPathComponent().lastPathComponent == "MediaDrop" else { return }
    MDAudioDownloadPolicy.removeWorkspace(directory)
  }

  private func storeCompletedTransfer(rawURI: String, phase: Phase) throws -> URL {
    guard let source = URL(string: rawURI), source.isFileURL, let workspaceURL else {
      throw MDAVMuxFailure.code("COMBINED_STORAGE_UNAVAILABLE")
    }
    let destination = workspaceURL.appendingPathComponent(
      phase == .video ? "video.mp4" : "audio.m4a",
      isDirectory: false
    )
    if FileManager.default.fileExists(atPath: destination.path) {
      try FileManager.default.removeItem(at: destination)
    }
    try FileManager.default.moveItem(at: source, to: destination)
    MDAudioDownloadPolicy.removeWorkspace(source.deletingLastPathComponent())
    return destination
  }

  private func startMux(jobID: String) {
    lock.lock()
    guard
      activeJobID == jobID,
      !cancellationRequested,
      let workspaceURL,
      let videoURL,
      let audioURL
    else {
      lock.unlock()
      fail(jobID: jobID, code: "MUX_INPUT_INVALID")
      return
    }
    let outputName = MDAudioDownloadPolicy.safeFileName(videoFileName, extension: "mp4")
    let outputURL = workspaceURL.appendingPathComponent(outputName, isDirectory: false)
    let duration = expectedDurationSeconds
    let muxer = MDAVMuxer()
    self.muxer = muxer
    lock.unlock()
    emit(jobID: jobID, status: "MUXING", progress: 0)
    muxer.start(
      videoURL: videoURL,
      audioURL: audioURL,
      outputURL: outputURL,
      expectedDurationSeconds: duration,
      progress: { [weak self] progress in
        self?.emit(jobID: jobID, status: "MUXING", progress: progress)
      },
      completion: { [weak self] result in
        self?.stateQueue.async { [weak self] in
          guard let self else { return }
          self.lock.lock()
          let isCancelling = self.cancellationRequested
          self.lock.unlock()
          if isCancelling {
            self.finishCancelled(jobID: jobID)
            return
          }
          switch result {
          case .success(let muxResult):
            self.complete(jobID: jobID, outputURL: outputURL, result: muxResult)
          case .failure(let failure):
            if failure.code == "LOCAL_CANCELLED" {
              self.finishCancelled(jobID: jobID)
            } else {
              self.fail(jobID: jobID, code: failure.code)
            }
          }
        }
      }
    )
  }

  private func complete(jobID: String, outputURL: URL, result: MDAVMuxResult) {
    lock.lock()
    guard activeJobID == jobID, !cancellationRequested else {
      lock.unlock()
      return
    }
    let inputVideo = videoURL
    let inputAudio = audioURL
    let height = videoHeight
    let codec = videoCodec
    let finalAudioCodec = audioCodec
    let diagnostics = videoHTTPDiagnostics
    resetLocked()
    lock.unlock()
    for input in [inputVideo, inputAudio].compactMap({ $0 }) {
      do {
        try FileManager.default.removeItem(at: input)
      } catch {
        NSLog("[Drop files] Completed mux input cleanup failed (code %ld)", (error as NSError).code)
      }
    }
    emit(
      jobID: jobID,
      status: "COMPLETED",
      progress: 1,
      fileName: outputURL.lastPathComponent,
      fileSize: result.fileSize,
      localUri: outputURL.absoluteString,
      durationSeconds: result.durationSeconds,
      height: height,
      videoCodec: codec,
      audioCodec: finalAudioCodec,
      videoHTTPDiagnostics: diagnostics
    )
  }

  private func fail(
    jobID: String,
    code: String,
    diagnostics: [String: Any]? = nil
  ) {
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      return
    }
    if cancellationRequested {
      lock.unlock()
      finishCancelled(jobID: jobID)
      return
    }
    let workspace = workspaceURL
    let activeMuxer = muxer
    let finalDiagnostics = diagnostics ?? videoHTTPDiagnostics
    resetLocked()
    lock.unlock()
    transfer.cancel()
    activeMuxer?.cancel()
    MDAudioDownloadPolicy.removeWorkspace(workspace)
    emit(
      jobID: jobID,
      status: "FAILED",
      errorCode: code,
      videoHTTPDiagnostics: finalDiagnostics
    )
  }

  private func finishCancelled(jobID: String) {
    lock.lock()
    guard activeJobID == jobID else {
      lock.unlock()
      return
    }
    let workspace = workspaceURL
    resetLocked()
    lock.unlock()
    MDAudioDownloadPolicy.removeWorkspace(workspace)
    emit(jobID: jobID, status: "CANCELLED")
  }

  private func resetLocked() {
    activeJobID = nil
    activeTransferJobID = nil
    phase = nil
    analysisID = ""
    videoFormatID = ""
    audioFormatID = ""
    expectedDurationSeconds = 0
    workspaceURL = nil
    videoURL = nil
    audioURL = nil
    videoFileName = "YouTube video.mp4"
    videoHeight = nil
    videoCodec = nil
    audioCodec = nil
    videoHTTPDiagnostics = nil
    muxer = nil
    cancellationRequested = false
  }

  private func emit(
    jobID: String,
    status: String,
    bytesDownloaded: Int64? = nil,
    totalBytes: Int64? = nil,
    progress: Double? = nil,
    fileName: String? = nil,
    fileSize: Int64? = nil,
    localUri: String? = nil,
    durationSeconds: Double? = nil,
    height: Int? = nil,
    videoCodec: String? = nil,
    audioCodec: String? = nil,
    errorCode: String? = nil,
    videoHTTPDiagnostics: [String: Any]? = nil
  ) {
    var event: [String: Any?] = ["jobId": jobID, "status": status]
    event["videoFormatId"] = videoFormatID
    event["audioFormatId"] = audioFormatID
    event["bytesDownloaded"] = bytesDownloaded
    event["totalBytes"] = totalBytes
    event["progress"] = progress
    event["fileName"] = fileName
    event["fileSize"] = fileSize
    event["localUri"] = localUri
    event["durationSeconds"] = durationSeconds
    event["height"] = height
    event["videoCodec"] = videoCodec
    event["audioCodec"] = audioCodec
    event["errorCode"] = errorCode
    event["videoHttpDiagnostics"] = videoHTTPDiagnostics
    DispatchQueue.main.async { [emitEvent] in emitEvent(event) }
  }
}
