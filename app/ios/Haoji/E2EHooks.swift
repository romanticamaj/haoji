import Foundation
import AVFoundation
import UIKit

/// Test hooks for driving scenarios that cannot otherwise be produced on a simulator.
///
/// Compiled ONLY for the simulator — `#if targetEnvironment(simulator)` means none of this exists in
/// the device build that goes to TestFlight or the App Store, so there is no dormant test surface in
/// what ships.
///
/// It posts the REAL AVAudioSession.interruptionNotification, so everything downstream is the actual
/// production path: the native observer, the event bridge, and the recorder's finalize/resume logic.
/// Only the origin of the interruption is synthetic — which is the one part a simulator cannot supply.
///
///   xcrun simctl openurl booted "haoji://e2e/interrupt?type=began"
///   xcrun simctl openurl booted "haoji://e2e/interrupt?type=ended&resume=1"
///   xcrun simctl openurl booted "haoji://e2e/interrupt?type=ended&resume=0"
enum E2EHooks {
  /// Darwin notification names the UI test posts. A URL cannot reach here from XCUITest — it runs in
  /// a separate process with no simctl and no shell — but Darwin notifications cross process
  /// boundaries on the same device, so the test can drive a real interruption directly.
  enum Darwin {
    static let began        = "haoji.e2e.interrupt.began"
    static let endedResume  = "haoji.e2e.interrupt.ended.resume"
    static let endedNoResume = "haoji.e2e.interrupt.ended.noresume"
    static let deactivate   = "haoji.e2e.deactivate"
    static let all = [began, endedResume, endedNoResume, deactivate]
  }

  /// Call once at launch. No-op off the simulator.
  static func registerDarwinTriggers() {
    #if targetEnvironment(simulator)
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    for name in Darwin.all {
      CFNotificationCenterAddObserver(
        center, nil,
        { _, _, name, _, _ in
          guard let raw = name?.rawValue as String? else { return }
          E2EHooks.perform(darwin: raw)
        },
        name as CFString, nil, .deliverImmediately)
    }
    NSLog("[E2E] darwin triggers registered")
    #endif
  }

  private static func perform(darwin name: String) {
    #if targetEnvironment(simulator)
    switch name {
    case Darwin.began:         postInterruption(began: true, shouldResume: false)
    case Darwin.endedResume:   postInterruption(began: false, shouldResume: true)
    case Darwin.endedNoResume: postInterruption(began: false, shouldResume: false)
    case Darwin.deactivate:    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    default: break
    }
    #endif
  }

  /// Posts the REAL system notification, so everything downstream is the production path.
  private static func postInterruption(began: Bool, shouldResume: Bool) {
    #if targetEnvironment(simulator)
    var info: [AnyHashable: Any] = [
      AVAudioSessionInterruptionTypeKey: (began ? AVAudioSession.InterruptionType.began
                                                : AVAudioSession.InterruptionType.ended).rawValue,
    ]
    if !began {
      info[AVAudioSessionInterruptionOptionKey] =
        shouldResume ? AVAudioSession.InterruptionOptions.shouldResume.rawValue : UInt(0)
    }
    NotificationCenter.default.post(name: AVAudioSession.interruptionNotification,
                                    object: AVAudioSession.sharedInstance(), userInfo: info)
    NSLog("[E2E] posted interruption \(began ? "began" : "ended")")
    #endif
  }

  static func handle(_ url: URL) -> Bool {
    #if targetEnvironment(simulator)
    guard url.scheme == "haoji", url.host == "e2e" else { return false }
    let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let q = { (name: String) in parts?.queryItems?.first { $0.name == name }?.value }

    switch url.path {
    case "/interrupt":
      let began = (q("type") ?? "began") == "began"
      postInterruption(began: began, shouldResume: (q("resume") ?? "1") != "0")
      return true

    case "/deactivate":
      // What a real call does to the session: take it away, so a resume attempt genuinely fails.
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      NSLog("[E2E] deactivated the audio session")
      return true

    default:
      return false
    }
    #else
    return false
    #endif
  }
}
