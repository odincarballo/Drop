#if canImport(UIKit)
import UIKit
import UniformTypeIdentifiers

@MainActor
final class DropLocalImportPicker: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  let requestID: Int
  private let operation: DropLocalImportOperation
  private weak var controller: UIDocumentPickerViewController?
  private var handled = false

  init(requestID: Int, onUpdate: @escaping (DropLocalImportUpdate) -> Void,
       completion: @escaping (DropLocalImportOutcome) -> Void) {
    self.requestID = requestID
    operation = DropLocalImportOperation(onUpdate: onUpdate, completion: completion)
  }

  func present(from presenter: UIViewController) throws {
    guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
      throw DropLocalImportFailure.pickerUnavailable
    }
    let picker = UIDocumentPickerViewController(
      forOpeningContentTypes: [.mp3, .mpeg4Audio, .mpeg4Movie], asCopy: false)
    picker.allowsMultipleSelection = false
    picker.delegate = self
    picker.presentationController?.delegate = self
    controller = picker
    if UIDevice.current.userInterfaceIdiom == .pad {
      picker.popoverPresentationController?.sourceView = presenter.view
      picker.popoverPresentationController?.sourceRect = presenter.view.bounds
    }
    presenter.present(picker, animated: true)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard !handled else { return }
    handled = true
    if controller.presentingViewController == nil { operation.selected(urls) }
    else { controller.dismiss(animated: true) { [self] in operation.selected(urls) } }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { cancel() }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard !handled else { return }
    handled = true
    operation.cancel()
  }

  @discardableResult
  func cancel() -> Bool {
    if !handled, let controller {
      handled = true
      controller.dismiss(animated: true) { [self] in operation.cancel() }
      return true
    }
    return operation.cancel()
  }
}
#endif
