import XCTest

/// The recording paths that used to need a real phone and a TestFlight round-trip.
///
/// These drive the actual recorder (AVAudioRecorder, real files on disk) and the actual interruption
/// path, and they assert on what the SCREEN says — which is the half that matters here: the bug that
/// cost a release showed up as a screen still reading 錄音中 while nothing was being saved. The audio
/// itself is checked separately by scripts/e2e-recording.mjs, which can read the container and run
/// ffprobe; a test process cannot.
final class RecordingInterruptionTests: XCTestCase {
  var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments += ["-HaojiUITest", "1"]
    app.launch()
  }

  // MARK: - helpers

  private func tap(_ label: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
    let el = app.buttons[label]
    XCTAssertTrue(el.waitForExistence(timeout: timeout), "找不到按鈕「\(label)」", file: file, line: line)
    el.tap()
  }

  private func assertText(_ label: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: timeout),
                  "畫面上沒有出現「\(label)」", file: file, line: line)
  }

  /// e2e-recording.mjs starts from a fresh install, so the first recording meets the system
  /// microphone prompt. Answer it the way a user would (springboard owns the alert).
  private func allowMicrophoneIfAsked() {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    for label in ["Allow", "允許", "好"] {
      let b = springboard.buttons[label]
      if b.waitForExistence(timeout: 2) { b.tap(); return }
    }
  }

  /// The mm:ss the recorder is showing right now, as seconds.
  private func timerSeconds(file: StaticString = #filePath, line: UInt = #line) -> Int {
    // The timer's accessibility label is a sentence (「已錄 00:04」), so match the mm:ss at the end.
    let clock = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^(已錄 )?\\d{2}:\\d{2}$")).firstMatch
    XCTAssertTrue(clock.waitForExistence(timeout: 5), "找不到計時器", file: file, line: line)
    let parts = clock.label.split(separator: " ").last.map { $0.split(separator: ":").compactMap { Int($0) } } ?? []
    return parts.count == 2 ? parts[0] * 60 + parts[1] : -1
  }

  private func startNewMeetingRecording() {
    // A fresh install opens on the first-run introduction (no server paired yet). Recording never
    // needs a server, so skip it the way a user would.
    let skip = app.buttons["略過介紹"]
    if skip.waitForExistence(timeout: 3) { skip.tap() }
    tap("記下來：開始錄音")
    tap("開始錄音")
    allowMicrophoneIfAsked()
    assertText("錄音中")
  }

  /// While RECORDING the first tap only arms the button (再按一次結束錄音) and a second confirms;
  /// while PAUSED one tap already finishes. Tap again only if the recorder is still on screen.
  private func stopRecording() {
    tap("停止錄音")
    let again = app.buttons["停止錄音"]
    if again.waitForExistence(timeout: 2) { again.tap() }
  }

  private func wait(_ seconds: TimeInterval) {
    _ = XCTWaiter.wait(for: [expectation(description: "錄音中")], timeout: seconds)
  }

  // MARK: - the scenario that cost a release

  /// 錄音中接到電話：畫面必須自己進入暫停，而且先前錄的秒數不能歸零。
  ///
  /// Every earlier fix left this looking identical to the bug — 錄音中, timer still counting — so
  /// this asserts the pause is real, not that an event was dispatched.
  func testCallDuringRecordingPausesAndKeepsElapsedTime() {
    startNewMeetingRecording()
    wait(6)
    let beforeCall = timerSeconds()
    XCTAssertGreaterThanOrEqual(beforeCall, 4, "接電話前應該已經錄了幾秒")

    E2ETrigger.callBegins()

    assertText("已暫停")
    assertText("錄音被中斷了")   // wording pass (GUIDELINE §5): title + 「已經錄下的部分都保存好了。」
    XCTAssertGreaterThanOrEqual(timerSeconds(), beforeCall,
                                "中斷後秒數不能倒退——歸零正是「前面全部被洗掉」的樣子")
  }

  /// 電話結束後 iOS 說可以繼續：App 應自動接續，總長包含通話前錄的部分。
  func testCallEndingResumesAutomaticallyAndKeepsTotalDuration() {
    startNewMeetingRecording()
    wait(6)
    let beforeCall = timerSeconds()

    E2ETrigger.callBegins()
    assertText("已暫停")

    E2ETrigger.callEndsResuming()
    assertText("錄音中")
    // 6s, not 5: the resumed part has to clear e2e-recording.mjs's "> 4 s per part" audio check with
    // room for the ~1s the session takes to reactivate.
    wait(6)

    XCTAssertGreaterThan(timerSeconds(), beforeCall, "續錄後總長必須大於通話前")
    stopRecording()
    assertText("錄好了，先聽聽看")
  }

  /// 續錄既有會議時又被打斷 —— 使用者回報被洗掉的那個組合。
  func testAppendingToAnExistingMeetingSurvivesAnInterruption() {
    // First meeting, kept as a draft.
    startNewMeetingRecording()
    wait(5)
    stopRecording()
    assertText("錄好了，先聽聽看")
    tap("稍後再說，先存起來")

    // Reopen it and continue recording.
    let meeting = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "今天")).firstMatch
    XCTAssertTrue(meeting.waitForExistence(timeout: 10), "列表上找不到剛存的會議")
    meeting.tap()
    // 繼續錄音 lives in the meeting's 「…」 menu since the Results restructure (#26).
    tap("更多動作")
    tap("繼續錄音")

    assertText("準備接著錄")
    let carriedOver = timerSeconds()
    XCTAssertGreaterThan(carriedOver, 0, "接續畫面應帶入既有長度，從 00:00 開始等於看不到既有錄音")

    tap("開始錄音")
    wait(5)
    E2ETrigger.callBegins()

    assertText("已暫停")
    XCTAssertGreaterThan(timerSeconds(), carriedOver, "既有錄音必須還在總長裡")

    E2ETrigger.callEndsResuming()
    assertText("錄音中")
    wait(4)
    stopRecording()
    assertText("錄好了，先聽聽看")
  }

  /// 通話還佔著麥克風時按繼續：必須停在「已暫停」。
  ///
  /// Dropping back to idle is what turned the record button into "start" again, and start() resets
  /// the part list — the exact path by which audio recorded before the call was overwritten.
  func testFailedResumeStaysPausedInsteadOfDroppingToIdle() {
    startNewMeetingRecording()
    wait(5)

    E2ETrigger.callBegins()
    assertText("已暫停")
    E2ETrigger.audioSessionTaken()      // the call keeps the session

    tap("繼續")

    // Either it recovered (fine) or it stayed paused (fine) — what must never happen is 準備錄音,
    // the idle screen, because that is the state that discards the parts already recorded.
    XCTAssertFalse(app.staticTexts["準備錄音"].waitForExistence(timeout: 4),
                   "續錄失敗後回到待機——這正是前面錄的內容被覆蓋的路徑")
  }

  /// 中斷後直接停止，已錄的內容仍要存下來。
  func testStoppingAfterAnInterruptionStillSavesTheRecording() {
    startNewMeetingRecording()
    wait(6)

    E2ETrigger.callBegins()
    assertText("已暫停")

    stopRecording()
    assertText("錄好了，先聽聽看")
  }
}
