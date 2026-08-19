import Foundation
import React

/// Uploads a recording part using an NSURLSession **background** configuration.
///
/// Why this exists: a normal fetch() upload dies the moment the app is suspended or swiped away, so a
/// user who starts a transcription and then leaves has to reopen the app for the upload to continue.
/// A background session is run by the OS itself — the transfer keeps going (and finishes) with the app
/// closed, and iOS relaunches the app in the background to deliver the completion event.
///
/// It PUTs the audio file as a raw body (see the backend's PUT /api/sessions/{id}/parts/{index}):
/// background sessions can only send a file, not a multipart form. The backend starts transcription by
/// itself once every expected part has landed, so the pipeline completes even if JS never runs again.
@objc(BackgroundUpload)
class BackgroundUpload: RCTEventEmitter, URLSessionDelegate, URLSessionTaskDelegate {
  private static let sessionIdentifier = "com.garyhsieh.haoji.bgupload"
  private var hasListeners = false

  /// Set by the AppDelegate when iOS wakes us to report finished background transfers.
  @objc static var backgroundCompletionHandler: (() -> Void)?

  override func supportedEvents() -> [String]! { ["backgroundUploadEvent"] }
  override static func requiresMainQueueSetup() -> Bool { false }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  /// Recreating this with the same identifier after a relaunch reconnects to the OS-managed session,
  /// so tasks that completed while the app was dead are reported to us here.
  private lazy var session: URLSession = {
    let cfg = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
    cfg.isDiscretionary = false          // start now, don't wait for "ideal" conditions
    cfg.sessionSendsLaunchEvents = true  // relaunch the app to deliver completion
    cfg.allowsCellularAccess = true
    return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
  }()

  private func emit(_ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: "backgroundUploadEvent", body: body)
  }

  /// Hand one part to the OS. `taskId` identifies it in the events we emit ("<sessionId>:<index>").
  @objc(enqueue:filePath:taskId:resolver:rejecter:)
  func enqueue(_ urlString: String, filePath: String, taskId: String,
               resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let url = URL(string: urlString) else {
      reject("bad_url", "Invalid upload URL: \(urlString)", nil); return
    }
    let path = filePath.replacingOccurrences(of: "file://", with: "")
    guard FileManager.default.fileExists(atPath: path) else {
      reject("missing_file", "File not found: \(path)", nil); return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")

    // The part files live in Documents and are not deleted until the session is, so the source stays
    // available for as long as the OS needs it — no temp copy required.
    let task = session.uploadTask(with: req, fromFile: URL(fileURLWithPath: path))
    task.taskDescription = taskId
    task.resume()
    resolve(taskId)
  }

  /// taskIds the OS is still working on — lets JS avoid re-enqueuing an upload already in flight.
  @objc(pendingTasks:rejecter:)
  func pendingTasks(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    session.getAllTasks { tasks in
      resolve(tasks.compactMap { $0.taskDescription })
    }
  }

  // MARK: - URLSession delegate

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let id = task.taskDescription ?? ""
    if let error = error {
      emit(["taskId": id, "state": "error", "error": error.localizedDescription])
      return
    }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    emit(["taskId": id, "state": (200...299).contains(status) ? "done" : "error",
          "status": status,
          "error": (200...299).contains(status) ? "" : "HTTP \(status)"])
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                  totalBytesExpectedToSend: Int64) {
    guard totalBytesExpectedToSend > 0 else { return }
    emit(["taskId": task.taskDescription ?? "", "state": "progress",
          "pct": Double(totalBytesSent) / Double(totalBytesExpectedToSend)])
  }

  /// Everything queued has finished while we were in the background — let iOS put us back to sleep.
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
      Self.backgroundCompletionHandler?()
      Self.backgroundCompletionHandler = nil
    }
  }
}
