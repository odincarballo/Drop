import ExpoModulesCore
import UIKit

private final class InvalidExportFileException: Exception, @unchecked Sendable {
  override var reason: String { "The local file is not available for export" }
}

private final class ExportPickerUnavailableException: Exception, @unchecked Sendable {
  override var reason: String { "The iOS Files picker cannot be presented" }
}

private final class ExportAlreadyActiveException: Exception, @unchecked Sendable {
  override var reason: String { "A Files export is already in progress" }
}

private final class DropExportDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var completion: ((String) -> Void)?

  init(completion: @escaping (String) -> Void) {
    self.completion = completion
  }

  private func finish(_ status: String) {
    guard let completion else { return }
    self.completion = nil
    completion(status)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.isEmpty ? "cancelled" : "saved")
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish("cancelled")
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish("cancelled")
  }
}

public final class DropFileExportModule: Module {
  private var activeDelegate: DropExportDelegate?

  public func definition() -> ModuleDefinition {
    Name("DropFileExport")

    Function("cleanupAbandonedFiles") { () -> [String: Int] in
      guard let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
        NSLog("[Drop files] Startup cache directory unavailable")
        return ["removed": 0, "failures": 1]
      }
      let result = DropOwnedCacheCleanup.runOnceAtStartup(cacheDirectory: cache)
      return ["removed": result.removed, "failures": result.failures]
    }

    AsyncFunction("createNamedExport") { (uri: String, name: String) throws -> [String: String] in
      let alias = try DropExportAlias.live().create(sourceURI: uri, name: name)
      return ["uri": alias.absoluteString]
    }

    AsyncFunction("removeNamedExport") { (uri: String) throws in
      try DropExportAlias.live().remove(aliasURI: uri)
    }

    AsyncFunction("saveToFiles") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri), url.isFileURL else {
        promise.reject(InvalidExportFileException())
        return
      }
      let fileURL = url.standardizedFileURL.resolvingSymlinksInPath()
      let sandbox = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true).standardizedFileURL.path
      var isDirectory: ObjCBool = false
      guard fileURL.path.hasPrefix(sandbox + "/"),
            FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory),
            !isDirectory.boolValue,
            FileManager.default.isReadableFile(atPath: fileURL.path) else {
        promise.reject(InvalidExportFileException())
        return
      }
      guard activeDelegate == nil else {
        promise.reject(ExportAlreadyActiveException())
        return
      }
      guard let presenter = appContext?.utilities?.currentViewController(),
            presenter.presentedViewController == nil else {
        promise.reject(ExportPickerUnavailableException())
        return
      }

      let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
      let delegate = DropExportDelegate { [weak self] status in
        self?.activeDelegate = nil
        promise.resolve(["status": status])
      }
      activeDelegate = delegate
      picker.delegate = delegate
      picker.presentationController?.delegate = delegate
      if UIDevice.current.userInterfaceIdiom == .pad {
        picker.popoverPresentationController?.sourceView = presenter.view
        picker.popoverPresentationController?.sourceRect = CGRect(
          x: presenter.view.bounds.midX,
          y: presenter.view.bounds.maxY,
          width: 0,
          height: 0
        )
      }
      presenter.present(picker, animated: true)
    }
    .runOnQueue(.main)
  }
}
