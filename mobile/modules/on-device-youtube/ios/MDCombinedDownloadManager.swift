import Foundation

final class MDCombinedDownloadManager {
  typealias EventSink = ([String: Any?]) -> Void

  private enum Phase {
    case video
    case audio
    case muxing
  }

  private let lock = NSLock()
  private let emitEvent: EventSink
  private lazy var transfer = MDAudioDownloadManager { [weak self] event in
    self?.handleTransferEvent(event)
  }
  private var activeJobID: String?
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
    do {
      let workspace = try MDAudioDownloadPolicy.workspace(for: jobID)
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
      guard transfer.startVideo(analysisID: analysisID, formatID: videoFormatID) != nil else {
        fail(jobID: jobID, code: "COMBINED_DOWNLOAD_BUSY")
        return nil
      }
      return jobID
    } catch let failure as MDAVMuxFailure {
      lock.unlock()
      emit(jobID: jobID, status: "FAILED", errorCode: failure.code)
      return nil
    } catch {
      lock.unlock()
      emit(jobID: jobID, status: "FAILED", errorCode: "COMBINED_STORAGE_UNAVAILABLE")
      return nil
    }
  }

  func cancel() {
    lock.lock()
    guard let jobID = activeJobID else {
      lock.unlock()
      return
    }
    let workspace = workspaceURL
    let activeMuxer = muxer
    resetLocked()
    lock.unlock()
    transfer.cancel()
    activeMuxer?.cancel()
    MDAudioDownloadPolicy.removeWorkspace(workspace)
    emit(jobID: jobID, status: "CANCELLED")
  }

  private func handleTransferEvent(_ event: [String: Any?]) {
    lock.lock()
    guard let jobID = activeJobID, let phase else {
      lock.unlock()
      return
    }
    lock.unlock()
    guard let status = event["status"] as? String else { return }
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
        guard transfer.startRangedAudio(analysisID: analysisID, formatID: audioFormatID) != nil else {
          fail(jobID: jobID, code: "COMBINED_DOWNLOAD_BUSY")
          return
        }
      } else {
        lock.lock()
        audioURL = stored
        audioCodec = event["codec"] as? String
        self.phase = .muxing
        lock.unlock()
        startMux(jobID: jobID)
      }
    } catch {
      fail(jobID: jobID, code: "COMBINED_STORAGE_UNAVAILABLE")
    }
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
        switch result {
        case .success(let muxResult):
          self?.complete(jobID: jobID, outputURL: outputURL, result: muxResult)
        case .failure(let failure):
          if failure.code == "LOCAL_CANCELLED" {
            self?.cancel()
          } else {
            self?.fail(jobID: jobID, code: failure.code)
          }
        }
      }
    )
  }

  private func complete(jobID: String, outputURL: URL, result: MDAVMuxResult) {
    lock.lock()
    guard activeJobID == jobID else {
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
    if let inputVideo { try? FileManager.default.removeItem(at: inputVideo) }
    if let inputAudio { try? FileManager.default.removeItem(at: inputAudio) }
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

  private func resetLocked() {
    activeJobID = nil
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
