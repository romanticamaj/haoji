import Foundation

/// Drives a real AVAudioSession interruption inside the app under test.
///
/// A UI test runs in its own process: it has no simctl, no shell, and no way to open a URL in the
/// app. Darwin notifications do cross process boundaries, so the app registers for these at launch
/// (E2EHooks.registerDarwinTriggers) and posts the genuine system notification when one arrives.
/// Everything downstream is then the production path — only the origin of the call is synthetic.
enum E2ETrigger {
  static func callBegins()          { post("haoji.e2e.interrupt.began") }
  static func callEndsResuming()    { post("haoji.e2e.interrupt.ended.resume") }
  static func callEndsNotResuming() { post("haoji.e2e.interrupt.ended.noresume") }
  /// Takes the audio session away, the way a real call does, so a resume attempt genuinely fails.
  static func audioSessionTaken()   { post("haoji.e2e.deactivate") }

  private static func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name as CFString), nil, nil, true)
  }
}
