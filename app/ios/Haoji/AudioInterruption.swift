import Foundation
import AVFoundation
import React

// Emits an "audioInterruption" event to JS when iOS interrupts the audio session
// (incoming call, Siri, alarm, etc.). useRecorder listens via DeviceEventEmitter and, if
// currently recording, finalizes the current part so resume() starts a fresh one.
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
          AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
    sendEvent(withName: "audioInterruption", body: nil)
  }
}
