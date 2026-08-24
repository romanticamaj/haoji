import Foundation
import AVFoundation
import React

// Emits an "audioInterruption" event to JS for BOTH edges of an audio-session interruption
// (incoming call, Siri, alarm, another app taking the session to play sound).
//   {type:"began"}                        → useRecorder finalizes the current part and pauses
//   {type:"ended", shouldResume:Bool}     → useRecorder starts a fresh part automatically
// Reporting only `began` left recordings stuck in a paused state once the interruption passed.
@objc(AudioInterruption)
class AudioInterruption: RCTEventEmitter {
  private var hasListeners = false
  private var selfRegistered = false

  override func supportedEvents() -> [String]! { ["audioInterruption"] }
  override static func requiresMainQueueSetup() -> Bool { false }

  // Observe from the moment the module exists, NOT from startObserving().
  //
  // RCTEventEmitter only calls startObserving() when JS subscribes THROUGH THE MODULE. We subscribe
  // with a bare DeviceEventEmitter (the New-Architecture-safe route), which never touches the module
  // — so startObserving() was never called, the notification was never observed, and audio
  // interruptions did not reach the app at all. A call froze the recording on screen with no pause,
  // no auto-resume, and no part finalised. Registering here removes that dependency entirely.
  override init() {
    super.init()
    NSLog("[AudioInterruption] module created; observing interruptions")
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  /// Called once from JS at startup for the side effect of EXISTING.
  ///
  /// React Native creates native modules lazily, on first use from JS. We listen for the event with
  /// a bare DeviceEventEmitter and never call into the module, so nothing ever caused it to be
  /// created — init() never ran, the notification was never observed, and a phone call did not
  /// reach the app at all. One no-op call at startup is what makes the observer exist.
  @objc func prepare() {
    // RCTEventEmitter DROPS every event while its listener count is zero, and that count only rises
    // when JS subscribes through the module. We subscribe with DeviceEventEmitter, so the count
    // stayed at zero and each interruption was discarded on the native side after being observed.
    // Registering ourselves as the listener — once, never removed — is what lets the event through.
    if !selfRegistered { selfRegistered = true; addListener("audioInterruption") }
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc private func handleInterruption(_ notification: Notification) {
    // No hasListeners guard: it depends on the same startObserving() that never runs for us.
    guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    NSLog("[AudioInterruption] interruption \(type == .began ? "began" : "ended") → JS")

    switch type {
    case .began:
      sendEvent(withName: "audioInterruption", body: ["type": "began"])
    case .ended:
      // iOS tells us when the interruption is OVER, and whether it is safe to pick up where we left
      // off. Ignoring this (as we used to) meant a recording stayed paused after, say, a demo video
      // finished playing — and everything said afterwards was silently lost unless the user noticed
      // and tapped resume.
      let optRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume)
      sendEvent(withName: "audioInterruption", body: ["type": "ended", "shouldResume": shouldResume])
    @unknown default:
      break
    }
  }
}
