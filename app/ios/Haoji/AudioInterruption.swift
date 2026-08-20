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

  override func supportedEvents() -> [String]! { ["audioInterruption"] }
  override static func requiresMainQueueSetup() -> Bool { false }

  override func startObserving() {
    hasListeners = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil)
  }

  override func stopObserving() {
    hasListeners = false
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard hasListeners,
          let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }

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
