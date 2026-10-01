import Foundation
import UIKit
import UserNotifications
import React

/// Remote notifications for "逐字稿完成".
///
/// Transcription finishes on the server, usually long after iOS has suspended the app — so the app
/// cannot announce it itself. Instead it hands its APNs device token to the backend with the session,
/// and the backend pushes when the job ends. This module does the phone's half: ask permission, get
/// the token, and report taps so JS can open the meeting.
///
/// `PushCenter` (not the module) is the notification-center delegate, because it must be installed in
/// didFinishLaunching — before React exists — or a tap that cold-launches the app is lost.
@objc(PushCenter)
class PushCenter: NSObject, UNUserNotificationCenterDelegate {
  @objc static let shared = PushCenter()

  private let lock = NSLock()
  private var waiters: [RCTPromiseResolveBlock] = []
  /// A tap that arrived before JS was listening (cold launch). JS collects it with initialOpen().
  private(set) var pendingOpen: String?
  weak var module: PushNotifications?

  /// sandbox for debug builds (development-signed), production for TestFlight / App Store.
  static var env: String {
#if DEBUG
    return "sandbox"
#else
    return "production"
#endif
  }

  func addWaiter(_ resolve: @escaping RCTPromiseResolveBlock) {
    lock.lock(); waiters.append(resolve); lock.unlock()
  }

  private func resolveAll(_ value: Any?) {
    lock.lock(); let ws = waiters; waiters = []; lock.unlock()
    ws.forEach { $0(value) }
  }

  @objc func didRegister(_ deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    resolveAll(["token": hex, "env": PushCenter.env])
  }

  @objc func didFailToRegister(_ error: Error) {
    NSLog("[push] registration failed: %@", error.localizedDescription)
    resolveAll(nil)
  }

  func takePendingOpen() -> String? {
    lock.lock(); defer { lock.unlock() }
    let s = pendingOpen; pendingOpen = nil
    return s
  }

  // Show the banner even with the app open — the user may be on a different meeting.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    if let session = response.notification.request.content.userInfo["session"] as? String, !session.isEmpty {
      NSLog("[push] tapped (session %@, js attached: %@)", session, (module?.attached ?? false) ? "yes" : "no")
      // Deliver straight to JS if it is listening; otherwise park it for initialOpen(). Never both,
      // or the meeting would be opened twice.
      if let m = module, m.attached {
        m.emitOpen(session)
      } else {
        lock.lock(); pendingOpen = session; lock.unlock()
      }
    }
    completionHandler()
  }
}

@objc(PushNotifications)
class PushNotifications: RCTEventEmitter {
  /// Set by attach(), NOT startObserving(): JS subscribes with DeviceEventEmitter, which never goes
  /// through the module, so startObserving() is never called (the same trap AudioInterruption hit).
  private(set) var attached = false

  override init() {
    super.init()
    PushCenter.shared.module = self
  }

  override func supportedEvents() -> [String]! { ["pushOpened"] }
  override static func requiresMainQueueSetup() -> Bool { false }
  func emitOpen(_ session: String) {
    NSLog("[push] → JS pushOpened %@", session)
    sendEvent(withName: "pushOpened", body: ["session": session])
  }

  /// Ask for permission (only prompts the first time) and resolve with {token, env}, or null if the
  /// user declined or registration failed.
  @objc(register:rejecter:)
  func register(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted else { resolve(nil); return }
      PushCenter.shared.addWaiter(resolve)
      DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
    }
  }

  /// JS is now listening for taps: deliver them live from here on, and hand back the one (if any)
  /// that launched the app before JS was ready.
  @objc(attach:rejecter:)
  func attach(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    PushCenter.shared.module = self
    // RCTEventEmitter DROPS every event while its listener count is zero, and only the module's own
    // addListener raises it — which DeviceEventEmitter never calls. Register ourselves, once, or every
    // live tap is discarded right here (layer 3 of the AudioInterruption bug).
    if !attached { addListener("pushOpened") }
    attached = true
    let pending = PushCenter.shared.takePendingOpen()
    NSLog("[push] JS attached; pending tap: %@", pending ?? "none")
    resolve(pending)
  }
}
