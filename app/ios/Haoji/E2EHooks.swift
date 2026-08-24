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
  static func handle(_ url: URL) -> Bool {
    #if targetEnvironment(simulator)
    guard url.scheme == "haoji", url.host == "e2e" else { return false }
    let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let q = { (name: String) in parts?.queryItems?.first { $0.name == name }?.value }

    switch url.path {
    case "/interrupt":
      let began = (q("type") ?? "began") == "began"
      var info: [AnyHashable: Any] = [
        AVAudioSessionInterruptionTypeKey: (began ? AVAudioSession.InterruptionType.began
                                                  : AVAudioSession.InterruptionType.ended).rawValue,
      ]
      if !began {
        let resume = (q("resume") ?? "1") != "0"
        info[AVAudioSessionInterruptionOptionKey] =
          resume ? AVAudioSession.InterruptionOptions.shouldResume.rawValue : UInt(0)
      }
      NotificationCenter.default.post(name: AVAudioSession.interruptionNotification,
                                      object: AVAudioSession.sharedInstance(), userInfo: info)
      NSLog("[E2E] posted interruption \(began ? "began" : "ended")")
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
