# Eject Haoji from Expo to Bare React Native — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute task-by-task; each task ends with an independently verifiable deliverable. Commit after each task.

**Goal:** Convert `app/` from Expo SDK 54 to a standard `@react-native-community/cli` React Native 0.81 app, fully owned, shipped to TestFlight locally via fastlane.

**Architecture:** Keep the `RecorderApi` / `SessionStore` / `api.ts` seams identical; swap every Expo library behind those seams; rebuild the toolchain and native projects; add a small Swift `AVAudioSession` interruption module; ship via fastlane using the existing ASC API key.

**Tech Stack:** React Native 0.81.5, React 19.1.0, TypeScript (strict), New Architecture on. Libs: `react-native-nitro-sound`, `react-native-fs`, `@react-native-clipboard/clipboard`, `react-native-share`, `@react-native-documents/picker`, `react-native-config`, reanimated 4 + worklets (unchanged), react-navigation (unchanged), AsyncStorage (unchanged). fastlane for TestFlight.

## Global Constraints

- React Native **0.81.5**, React **19.1.0** (match current pins so reanimated 4 / worklets stay valid). New Architecture **enabled**.
- Bundle id **`com.garyhsieh.haoji`**; display name **`好記`**.
- Zero `expo*` dependencies or Expo config files at the end.
- `RecorderApi` (hooks/useRecorder.ts), `SessionStore` (lib/store.ts), and `api.ts` public signatures stay **byte-for-byte identical**.
- Backend base URL default (Release): `http://100.106.118.45:8780`; LAN alt: `http://192.168.100.10:8780`.
- ASC API key: id `S4KA24P9A5`, issuer `efcfbd71-5d12-4d85-8efc-5cee020286d9`, team `64N77Z6TV3`, key file `~/.private_keys/AuthKey_S4KA24P9A5.p8`.
- Mic usage string: `好記需要麥克風來錄製會議音訊。`
- All work on branch `eject-expo-bare-rn`. Commit after every task.
- `npm test` (jest, `react-native` preset) must stay green from Task 4 onward.

---

## Strategy note on scaffolding

The repo already has `app/` with our TS source under git history. We **regenerate the native/toolchain layer** by initializing a fresh RN-CLI project **already named `Haoji`** (init-as-final-name — do NOT scaffold under a placeholder and rename; renaming misses `AppDelegate` `moduleName`, `project.pbxproj`, scheme XML, and the Podfile target, any of which produces a blank screen — ref review F7). We then copy its native projects (`ios/`, `android/`), `metro.config.js`, and RN `app.json` into `app/`, and rewrite `package.json`/`babel`/`jest`/`tsconfig`. Our `screens/ components/ lib/ hooks/ App.tsx navigation.tsx assets/` are preserved and edited in place. Only the **bundle id** and **display name** need changing (the app *name*/module name stays `Haoji`).

**Tooling note (review F1):** the system Ruby is 2.6.10, too old for `bundle exec` with modern fastlane, but the **globally installed** `fastlane` (2.236.1) and `pod` (1.16.2) both run fine (verified). Therefore we call `pod` and `fastlane` **directly, never via bundler**, and do not add a `Gemfile`.

---

## Task 1: Scaffold clean RN-CLI native shell (named Haoji) into `app/`

**Files:**
- Create: `app/metro.config.js`
- Replace: `app/ios/` (native project), `app/android/` (native project), `app/app.json` (RN-CLI form)
- Modify: `app/.gitignore` (remove the Expo-era `/ios` and `/android` ignore lines — review F13)
- Remove: `app/eas.json`, `app/.expo/`

- [ ] **Step 1: Init scaffold with the FINAL name**

```bash
cd /private/tmp/claude-501/-Users-gary-hsieh-garysrc-haoji/*/scratchpad || cd /private/tmp
npx @react-native-community/cli@latest init Haoji --version 0.81.5 --skip-install --pm npm
```
Expected: `Haoji/` with `ios/Haoji.xcodeproj`, `ios/Haoji/AppDelegate.swift` (`moduleName:"Haoji"`), `android/`, `metro.config.js`, `app.json` (`{"name":"Haoji","displayName":"Haoji"}`).

- [ ] **Step 2: Fix app/.gitignore, then copy native shell into app/**

```bash
D=/Users/gary.hsieh/garysrc/haoji/app
# Review F13: these Expo-era lines would silently drop the committed native dirs
sed -i '' '/^\/ios$/d; /^\/android$/d' $D/.gitignore
S=<scratchpad>/Haoji
rm -rf $D/ios $D/android $D/.expo $D/eas.json
cp -R $S/ios $S/android $D/
cp $S/metro.config.js $D/
```

- [ ] **Step 3: Set app.json + display name + bundle id (no target rename)**

`app/app.json`:
```json
{ "name": "Haoji", "displayName": "好記" }
```
- iOS: `app/ios/Haoji/Info.plist` → `CFBundleDisplayName` = `好記`; in `app/ios/Haoji.xcodeproj/project.pbxproj` set every `PRODUCT_BUNDLE_IDENTIFIER` to `com.garyhsieh.haoji`.
- Android: `app/android/app/build.gradle` → `namespace` and `applicationId` = `com.garyhsieh.haoji`; move the `MainActivity.kt`/`MainApplication.kt` dir from `com/haoji` to `com/garyhsieh/haoji` and update their `package` declarations; `app/android/app/src/main/res/values/strings.xml` `app_name` = `好記`.
- The JS **module name stays `Haoji`** — do not touch `AppDelegate.swift` `moduleName` or the `.xcodeproj`/scheme names.

- [ ] **Step 4: Verify** — `ls app/ios/Haoji.xcworkspace` exists; `grep -rc com.garyhsieh.haoji app/ios/Haoji.xcodeproj/project.pbxproj` ≥ 2; `grep moduleName app/ios/Haoji/AppDelegate.swift` shows `"Haoji"`; `git check-ignore app/ios/Haoji/AppDelegate.swift` returns nothing (not ignored).

- [ ] **Step 5: Commit** — `git add -A app/ios app/android app/app.json app/metro.config.js app/.gitignore && git commit -m "chore(app): scaffold bare RN 0.81 native shell (Haoji, com.garyhsieh.haoji)"`

---

## Task 2: Rewrite JS toolchain (babel, jest, tsconfig, entry) + deps

**Files:**
- Modify: `app/package.json`, `app/babel.config.js`, `app/jest.config.js`, `app/jest-setup.js`, `app/tsconfig.json`
- Create: `app/index.js` (replaces `app/index.ts`)
- Remove: `app/index.ts`

- [ ] **Step 1: package.json** — remove all `expo*`, `babel-preset-expo`, `jest-expo`, `eas-cli`, `expo-status-bar`. Add deps: `react-native-nitro-sound`, `react-native-fs`, `@react-native-clipboard/clipboard`, `react-native-share`, `@react-native-documents/picker`, `react-native-config`. Add devDeps: `@react-native/babel-preset`, `@react-native/eslint-config`, `@react-native/metro-config`, `@react-native/typescript-config`. Scripts (pod runs directly, NOT via bundler — review F1):
```json
"scripts": { "start": "react-native start", "ios": "react-native run-ios", "android": "react-native run-android", "test": "jest", "pods": "cd ios && pod install" }
```

- [ ] **Step 2: babel.config.js**
```js
module.exports = { presets: ['module:@react-native/babel-preset'], plugins: ['react-native-worklets/plugin'] };
```

- [ ] **Step 3: index.js**
```js
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
AppRegistry.registerComponent(appName, () => App);
```
Delete `index.ts`. Update `package.json` `"main"` to `"index.js"`.

Also **grep and kill any `expo-status-bar` import** (review F15): `grep -rn "expo-status-bar" app/App.tsx app/screens app/components`. If found, replace `<StatusBar .../>` from `expo-status-bar` with React Native's `import { StatusBar } from 'react-native'` (or remove if purely decorative). Don't defer this to the Task 11 typecheck.

- [ ] **Step 4: tsconfig.json**
```json
{ "extends": "@react-native/typescript-config", "compilerOptions": { "strict": true } }
```

- [ ] **Step 5: jest.config.js**
```js
module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest-setup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation/.*|@react-native-async-storage/.*|react-native-nitro-sound|react-native-fs|react-native-share|@react-native-documents/.*|@react-native-clipboard/.*|react-native-config|react-native-reanimated|react-native-worklets|react-native-markdown-display)/)',
  ],
};
```
(`react-native-markdown-display` **must** be in the exception list — review F10 — else `AnalysisTab` tests throw `SyntaxError: Unexpected token 'export'`; jest-expo used to cover it implicitly.)

- [ ] **Step 6: jest-setup.js** — drop nothing reanimated; add explicit mocks:
```js
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-config', () => ({ API_BASE: 'http://127.0.0.1:8780' }));
// nitro-sound / fs / clipboard / share / picker get per-test mocks (see later tasks)
```

- [ ] **Step 7: install & typecheck**
```bash
cd app && npm install && npx tsc --noEmit
```
Expected: install succeeds; tsc reports errors ONLY in the 6 files still importing expo (fixed in Tasks 5–8). Record them; they are expected.

- [ ] **Step 8: Commit** — `git commit -am "chore(app): bare RN toolchain (babel/jest/tsconfig/entry) + swap deps"`

---

## Task 3: `react-native-config` for backend URL (replace EXPO_PUBLIC_API_BASE)

**Files:**
- Modify: `app/lib/config.ts`, `app/lib/__tests__/config.test.ts`
- Create: `app/.env`, `app/.env.example`

**Interfaces:**
- Produces: `API_BASE: string` (unchanged export name/type from `lib/config.ts`).

- [ ] **Step 1: Update test** `app/lib/__tests__/config.test.ts`
```ts
jest.mock('react-native-config', () => ({ API_BASE: 'http://example.test:8780' }));
import { API_BASE } from '../config';
test('API_BASE comes from native config', () => {
  expect(API_BASE).toBe('http://example.test:8780');
});
```

- [ ] **Step 2: Run — expect FAIL** (`config.ts` still reads `process.env`). `npx jest config.test -v`

- [ ] **Step 3: Rewrite `lib/config.ts`**
```ts
import Config from 'react-native-config';
// Backend base URL, injected per build scheme via react-native-config (.env).
export const API_BASE: string = Config.API_BASE ?? 'http://127.0.0.1:8780';
```

- [ ] **Step 4: `.env`** → `API_BASE=http://100.106.118.45:8780`; `.env.example` documents LAN alt `http://192.168.100.10:8780`. Add `.env` to `app/.gitignore`.

- [ ] **Step 5: Run — expect PASS.** `npx jest config.test -v`

- [ ] **Step 6: Commit** — `git commit -am "feat(app): backend URL via react-native-config"`

---

## Task 4: Swap `expo-file-system` → `react-native-fs` in `lib/recordings.ts`

**Files:**
- Modify: `app/lib/recordings.ts`, `app/lib/__tests__/recordings.test.ts`

**Interfaces:**
- Produces (unchanged signatures): `partPath(sid, i): string`, `ensureDir(sid): Promise<void>`, `moveToPart(sid, index, fromUri): Promise<string>`.
- **Path convention (review F9):** `partPath` AND `moveToPart` BOTH return `file://`-prefixed URIs — matching the old expo-file-system behavior so `useRecorder`/`usePlayer`/`uploadPart` callers are unchanged and never double-prefix. RNFS takes bare POSIX paths, so we strip `file://` before every RNFS call and re-add it on return. An internal `bare()` helper is the single source of truth.

- [ ] **Step 1: Rewrite test mock + assertions** `recordings.test.ts` — replace the `expo-file-system/legacy` mock with:
```ts
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
```
Update the assertion to the `file://`-prefixed shape: `expect(partPath('abc', 0)).toBe('file:///doc/haoji/abc/part-0.m4a')`. Assert `RNFS.moveFile` is called with **bare** paths (no `file://`), and `moveToPart(...)` resolves to a `file://` URI.

- [ ] **Step 2: Run — expect FAIL.** `npx jest recordings.test -v`

- [ ] **Step 3: Rewrite `lib/recordings.ts`**
```ts
import RNFS from 'react-native-fs';
// RNFS wants bare POSIX paths; the rest of the app wants file:// URIs. Convert at the edges.
const bare = (p: string) => p.replace(/^file:\/\//, '');
const root = (sid: string) => `${RNFS.DocumentDirectoryPath}/haoji/${sid}`;
export const partPath = (sid: string, i: number) => `file://${root(sid)}/part-${i}.m4a`;
export async function ensureDir(sid: string) {
  await RNFS.mkdir(root(sid));
}
// Move a just-finished recording out of the recorder's temp/cache location into the
// persistent per-session document dir so raw parts survive app restarts. Returns a file:// URI.
export async function moveToPart(sid: string, index: number, fromUri: string): Promise<string> {
  await ensureDir(sid);
  const dest = partPath(sid, index);          // file:// URI
  const destBare = bare(dest);
  if (await RNFS.exists(destBare)) { await RNFS.unlink(destBare); }
  await RNFS.moveFile(bare(fromUri), destBare);
  return dest;
}
```

- [ ] **Step 4: Run — expect PASS.** `npx jest recordings.test -v`
- [ ] **Step 5: Commit** — `git commit -am "feat(app): recordings.ts on react-native-fs"`

---

## Task 5: Swap clipboard + sharing + file-system in `screens/AnalysisTab.tsx`

**Files:**
- Modify: `app/screens/AnalysisTab.tsx`, `app/screens/__tests__/AnalysisTab.test.tsx`

- [ ] **Step 1: Update test mocks** in `AnalysisTab.test.tsx`:
```ts
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('react-native-share', () => ({ default: { open: jest.fn().mockResolvedValue({}) } }));
jest.mock('react-native-fs', () => ({ writeFile: jest.fn().mockResolvedValue(undefined), DocumentDirectoryPath: '/doc', unlink: jest.fn() }));
```
Adjust assertions to the new call names (`Clipboard.setString`, `Share.open`).

- [ ] **Step 2: Run — expect FAIL.** `npx jest AnalysisTab.test -v`

- [ ] **Step 3: Rewrite imports + call sites** in `AnalysisTab.tsx`:
```ts
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
```
- Copy: `Clipboard.setString(notes)` — **synchronous**, replacing the old `await Clipboard.setStringAsync(...)` (review F6). Remove the `await`.
- Export/share: **remove the old `Sharing.isAvailableAsync()` guard entirely** (review F6) — `react-native-share` has no such gate. Write notes to a temp `.md` in `RNFS.DocumentDirectoryPath`, then `await Share.open({ url: 'file://' + path, type: 'text/markdown', filename: '會議記錄.md' })`; `unlink` after. Wrap in try/catch and swallow the user-cancelled rejection (`Share.open` rejects when the user dismisses the sheet) so a cancel isn't surfaced as an error.

- [ ] **Step 4: Run — expect PASS.** `npx jest AnalysisTab.test AnalysisTab.markdown.test -v`
  Note: the old test asserted `isAvailableAsync===false ⇒ shareAsync not called`; that assertion is **deleted** (guard removed). Replace it with an assertion that `Share.open` is called with a `file://…會議記錄.md` url.
- [ ] **Step 5: Commit** — `git commit -am "feat(app): AnalysisTab on clipboard/share/fs"`

---

## Task 6: Swap `expo-document-picker` → `@react-native-documents/picker` in `RecordScreen.tsx`

**Files:**
- Modify: `app/screens/RecordScreen.tsx`, `app/screens/__tests__/RecordScreen.parts.test.tsx`, **and** `app/screens/__tests__/RecordScreen.test.tsx` (review F5 — BOTH test files currently mock `expo-document-picker` with `getDocumentAsync`; the second one's "upload a file" case silently breaks if left on the old mock).

- [ ] **Step 1: Update mock in BOTH RecordScreen test files** — replace every `jest.mock('expo-document-picker', ...)` (with `getDocumentAsync`) with:
```ts
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn().mockResolvedValue([{ uri: 'file:///tmp/a.m4a', name: 'a.m4a', type: 'audio/m4a' }]),
  types: { audio: 'public.audio', video: 'public.movie' },
}));
```
Update assertions in both files to the new result shape (array of `{uri,name,type}`); grep first: `grep -rln "expo-document-picker\|getDocumentAsync" app/screens/__tests__`.

- [ ] **Step 2: Run — expect FAIL.** `npx jest RecordScreen -v`

- [ ] **Step 3: Rewrite** `RecordScreen.tsx` picker call:
```ts
import { pick, types } from '@react-native-documents/picker';
const [file] = await pick({ type: [types.audio, types.video] });
// map file.uri/file.name/file.type into the existing uploadPart({uri,name,mime}) shape
```
Preserve the existing upload→Processing navigation flow.

- [ ] **Step 4: Run — expect PASS.** `npx jest RecordScreen -v`
- [ ] **Step 5: Commit** — `git commit -am "feat(app): document picker via @react-native-documents/picker"`

---

## Task 7: Port audio hooks to `react-native-nitro-sound` (usePlayer first)

**Files:**
- Modify: `app/hooks/usePlayer.ts`, `app/hooks/__tests__/usePlayer.test.tsx`

**Interfaces:**
- Produces (unchanged public shape of usePlayer): whatever the current hook exports — keep identical.

**Singleton caveat (review F4):** `react-native-nitro-sound` is a **singleton** — one recorder+player sharing the native audio session, not per-instance like `expo-av`'s `Audio.Sound`. Playback happens only on the Results screen and recording only on the Record screen, so they never overlap in practice — but `usePlayer` must `stopPlayer()` on unmount/track-change to release the singleton, and must not assume it can run concurrently with recording. `seekToPlayer(ms)` returns `Promise<string>`; discard the return (don't type it `void`).

- [ ] **Step 1: Update mock** — replace `expo-av` mock with a `react-native-nitro-sound` mock exposing `startPlayer`, `pausePlayer`, `resumePlayer`, `stopPlayer`, `seekToPlayer`, `addPlayBackListener`, `removePlayBackListener`.
- [ ] **Step 2: Run — expect FAIL.** `npx jest usePlayer -v`
- [ ] **Step 3: Rewrite** `usePlayer.ts` on nitro-sound (`Sound.startPlayer(uri)`, `addPlayBackListener(e => …)` → `e.currentPosition`/`e.duration`, `pausePlayer`/`resumePlayer`/`stopPlayer`, `seekToPlayer`). Call `stopPlayer()` + `removePlayBackListener()` on cleanup. Keep the exported API identical.
- [ ] **Step 4: Run — expect PASS.** `npx jest usePlayer -v`
- [ ] **Step 5: Commit** — `git commit -am "feat(app): usePlayer on react-native-nitro-sound"`

---

## Task 8: Port `useRecorder` to nitro-sound + AVAudioSession interruption module

**Files:**
- Modify: `app/hooks/useRecorder.ts`, `app/hooks/__tests__/useRecorder.parts.test.tsx`
- Create (iOS native): `app/ios/Haoji/AudioInterruption.swift` (an **`RCTEventEmitter` subclass**) + `app/ios/Haoji/AudioInterruption.m` (the ObjC `RCT_EXTERN_MODULE` bridge — mandatory, without it the Swift class is invisible to RN)
- Create (JS): `app/lib/audioInterruption.ts` (thin wrapper)

**Interfaces:**
- Consumes: `moveToPart` (Task 4), `ensureDir` (Task 4).
- Produces (unchanged): `RecorderApi` — `{ state, durationMs, meteringLevel, parts, wasInterrupted, start, pause, resume, stop }` with identical types.

**New-Architecture note (review F2 — BLOCKER):** RN 0.81 runs the New Architecture (reanimated 4 requires it). The naive `new NativeEventEmitter(NativeModules.AudioInterruption)` pattern gets `undefined` for a bespoke module and the guard silently no-ops → the interruption event **never fires** and `onInterrupted` becomes dead code. Fix: native is an **`RCTEventEmitter` subclass** sending via `sendEventWithName:` (routed through `RCTDeviceEventEmitter`, preserved by the New-Arch interop layer); JS listens with **`DeviceEventEmitter`**, avoiding any `NativeModules` lookup.

- [ ] **Step 1: JS interruption wrapper** `lib/audioInterruption.ts`
```ts
import { DeviceEventEmitter } from 'react-native';
// Fires when iOS interrupts the audio session (call, Siri, etc.). No-op on Android/jest.
export function onAudioInterruption(cb: () => void): () => void {
  const sub = DeviceEventEmitter.addListener('audioInterruption', cb);
  return () => sub.remove();
}
```

- [ ] **Step 2: Update recorder test mock** — mock `react-native-nitro-sound` (`startRecorder`, `pauseRecorder`, `resumeRecorder`, `stopRecorder`, single-listener `addRecordBackListener` emitting `{ currentPosition, currentMetering }`, `removeRecordBackListener`) and mock `../lib/audioInterruption` so a test can invoke the interruption callback. Keep ALL existing parts/interruption behavioral assertions (C1/I2: interruption finalizes a part and resume starts a new one; manual pause/resume stays same part).

- [ ] **Step 3: Run — expect FAIL.** `npx jest useRecorder -v`

- [ ] **Step 4: Rewrite `useRecorder.ts`** — same state machine and `C1`/`I2` ordering, but:
  - `beginPart()`: `await Sound.startRecorder(path, audioSet, /* meteringEnabled */ true)` — the `true` is **mandatory** (review F3), else `currentMetering` is undefined and the waveform is permanently flat. Then `Sound.addRecordBackListener(e => { setDurationMs(e.currentPosition); setMeteringLevel(dbToLevel(e.currentMetering)); })` (single listener; re-calling on part 2 replaces it — fine here).
  - `finalize()`: `await Sound.stopRecorder(); Sound.removeRecordBackListener();` then `moveToPart(...)`.
  - Interruption: in `start()`, register `onAudioInterruption(() => { if (stateRef.current==='recording') void onInterrupted(); })`; unsubscribe in `stop()`.
  - Keep `stateRef` mirror, `goto()` ordering, `wasInterrupted` → new part on resume. Public `RecorderApi` unchanged.

- [ ] **Step 5: Run — expect PASS.** `npx jest useRecorder -v`

- [ ] **Step 6: Write the native module (RCTEventEmitter pattern).**
  `AudioInterruption.swift`:
```swift
import AVFoundation
@objc(AudioInterruption)
class AudioInterruption: RCTEventEmitter {
  private var hasListeners = false
  override func supportedEvents() -> [String]! { ["audioInterruption"] }
  override static func requiresMainQueueSetup() -> Bool { false }
  override func startObserving() {
    hasListeners = true
    NotificationCenter.default.addObserver(
      self, selector: #selector(onInterruption(_:)),
      name: AVAudioSession.interruptionNotification, object: nil)
  }
  override func stopObserving() {
    hasListeners = false
    NotificationCenter.default.removeObserver(self)
  }
  @objc private func onInterruption(_ n: Notification) {
    guard hasListeners,
      let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
    sendEvent(withName: "audioInterruption", body: nil)
  }
}
```
  `AudioInterruption.m` (bridge):
```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
@interface RCT_EXTERN_MODULE(AudioInterruption, RCTEventEmitter)
@end
```
  Add both files to the `Haoji` Xcode target; the RN scaffold's `Haoji-Bridging-Header.h` must import `<React/RCTEventEmitter.h>`.

- [ ] **Step 7: Commit** — `git commit -am "feat(app): useRecorder on nitro-sound (metering on) + RCTEventEmitter interruption module"`

---

## Task 9: iOS native config (Info.plist) + pods + simulator smoke build

**Files:**
- Modify: `app/ios/Haoji/Info.plist`, `app/ios/Podfile`

- [ ] **Step 1: Info.plist** — add `NSMicrophoneUsageDescription` = `好記需要麥克風來錄製會議音訊。`; `UIBackgroundModes` = `[audio]`; `NSAppTransportSecurity` exception dict for `100.106.118.45` and `192.168.100.10` (`NSExceptionAllowsInsecureHTTPLoads=true`).
- [ ] **Step 2: Podfile** — ensure `use_native_modules!` + New Arch; add `permissions`/config pods only if a lib requires. `react-native-config` needs its `podspec` autolinked (default). 
- [ ] **Step 3: Install pods** — `cd app/ios && pod install` (global CocoaPods 1.16.2, **not** `bundle exec` — review F1). Expected: succeeds, links nitro-sound / fs / share / picker / clipboard / config; New-Arch pods generate.
- [ ] **Step 4: Metro + build to booted simulator**
```bash
cd app && npx react-native run-ios --simulator "iPhone 17"
```
Expected: app builds, boots, Home screen renders. (Recording won't function on simulator — that's expected; verify no red-box on launch/navigation.)
- [ ] **Step 5: Commit** — `git commit -am "chore(ios): Info.plist perms/ATS + pods; simulator smoke passes"`

---

## Task 10: Android native config (build parity, not shipped this pass)

**Files:**
- Modify: `app/android/app/src/main/AndroidManifest.xml`, create `app/android/app/src/main/res/xml/network_security_config.xml`

- [ ] **Step 1:** Add `<uses-permission android:name="android.permission.RECORD_AUDIO"/>`.
- [ ] **Step 2:** Create `network_security_config.xml` allowing cleartext to `100.106.118.45` + `192.168.100.10`; reference via `android:networkSecurityConfig` + `android:usesCleartextTraffic="false"` on `<application>`.
- [ ] **Step 3:** `cd app/android && ./gradlew assembleDebug` — expect BUILD SUCCESSFUL (compile parity only; not installed).
- [ ] **Step 4: Commit** — `git commit -am "chore(android): RECORD_AUDIO + cleartext config; debug build passes"`

---

## Task 11: Full test suite green + typecheck

- [ ] **Step 1:** `cd app && npx tsc --noEmit` — expect 0 errors (all expo imports gone).
- [ ] **Step 2:** `cd app && npm test` — expect all suites pass.
- [ ] **Step 3:** Fix any stragglers (leftover expo mocks in other test files: `api.parts.test`, `ProcessingScreen.parts.test`, etc.). Grep: `grep -rn expo app/**/*.test.*`.
- [ ] **Step 4: Commit** — `git commit -am "test(app): full suite green on bare RN"`

---

## Task 12: fastlane `beta` lane → TestFlight

**Files:**
- Create: `app/ios/fastlane/Appfile`, `app/ios/fastlane/Fastfile`, `app/ios/fastlane/.gitignore`
- Modify: `app/.gitignore` (ignore `*.p8`, `ios/fastlane/report.xml`, build artifacts)

- [ ] **Step 1: Appfile**
```ruby
app_identifier("com.garyhsieh.haoji")
team_id("64N77Z6TV3")
```

**Signing prerequisite (review F8, F17):** first, in Xcode set the `Haoji` target to **manual signing** ("Automatically manage signing" OFF) so `build_app`'s export uses the profile `sigh` provides rather than guessing an automatic one. The ASC API key must hold **Admin or Developer** role in team `64N77Z6TV3` for `cert` to create an Apple Distribution certificate; App Manager alone can't create certs.

- [ ] **Step 2: Fastfile** — `beta` lane (`cert` explicitly Distribution; `build_app` gets manual `export_options` with the profile name; `increment_build_number` xcodeproj path is relative to the dir that holds `fastlane/`, i.e. `app/ios`, so `"Haoji.xcodeproj"` is correct):
```ruby
default_platform(:ios)
platform :ios do
  desc "Build and upload to TestFlight"
  lane :beta do
    key = app_store_connect_api_key(
      key_id: "S4KA24P9A5",
      issuer_id: "efcfbd71-5d12-4d85-8efc-5cee020286d9",
      key_filepath: File.expand_path("~/.private_keys/AuthKey_S4KA24P9A5.p8"),
    )
    increment_build_number(
      build_number: latest_testflight_build_number(api_key: key, app_identifier: "com.garyhsieh.haoji").to_i + 1,
      xcodeproj: "Haoji.xcodeproj",
    )
    # development: false → Apple *Distribution* cert (review F17). Needs Admin/Developer role on the ASC key.
    cert(api_key: key, development: false, output_path: "./certs")
    profile_name = "Haoji AppStore"
    sigh(api_key: key, app_identifier: "com.garyhsieh.haoji", platform: "ios",
         provisioning_name: profile_name)
    build_app(
      workspace: "Haoji.xcworkspace",
      scheme: "Haoji",
      configuration: "Release",
      export_method: "app-store",
      export_options: {
        signingStyle: "manual",
        provisioningProfiles: { "com.garyhsieh.haoji" => profile_name },
      },
    )
    upload_to_testflight(api_key: key, skip_waiting_for_build_processing: true)
  end
end
```

- [ ] **Step 3: Run** — `cd app/ios && fastlane beta` (global fastlane, **not** `bundle exec` — review F1: system Ruby 2.6 can't run modern fastlane under bundler).
  - **Expected happy path:** Distribution cert + `Haoji AppStore` profile created, Release archive built + signed manually, `.ipa` uploaded, build appears in TestFlight (processing).
  - **Human-wall cases (STOP and report exactly):** ASC key lacks cert-creation role on team `64N77Z6TV3` (Apple: "not authorized"/"forbidden"); "maximum number of certificates" reached; Apple Developer Program agreement not accepted. Report the exact Apple message + the App Store Connect / developer.apple.com URL to resolve — do not retry blindly.
- [ ] **Step 4: Commit** — `git commit -am "ci(ios): fastlane beta lane for TestFlight (ASC API key)"`

---

## Task 13: Docs cleanup

**Files:**
- Modify: `CLAUDE.md`, `app/AGENTS.md`, `app/CLAUDE.md`, `README.md`, `app/MANUAL-QA.md`

- [ ] **Step 1:** `CLAUDE.md` (root) — replace Expo/EAS commands with bare-RN (`npm run ios`, `npm run pods`, `fastlane beta`); remove SDK 54/56 guidance; update the library table.
- [ ] **Step 2:** `app/AGENTS.md` — replace the Expo v56 note with bare-RN guidance (RN 0.81 docs, New Arch, pod install after dep changes).
- [ ] **Step 3:** `app/MANUAL-QA.md` — replace "Expo Go" with "dev build / TestFlight"; add the interruption case (phone call mid-record → resume → new part).
- [ ] **Step 4:** `README.md` — platform line: native RN (no Expo).
- [ ] **Step 5: Commit** — `git commit -am "docs: reflect bare RN + fastlane TestFlight"`

---

## Self-Review (spec coverage)

- Spec §1 scaffold → Task 1. §2 lib swaps → Tasks 3–8. §3 audio+interruption → Tasks 7–8. §4 toolchain → Task 2. §5 native config → Tasks 9–10. §6 fastlane → Task 12. §7 testing → Tasks 3–8,11 + §MANUAL-QA in Task 13. §8 sequencing → task order. Acceptance criteria: zero expo (Task 11 grep), jest green (Task 11), device build (Task 9 sim / Task 12 TestFlight), TestFlight (Task 12). All covered.
- Type consistency: `RecorderApi`/`SessionStore`/`API_BASE`/`partPath`/`moveToPart` names preserved across tasks.
- Placeholder scan: native module (Task 8 Step 6) and some screen call-sites describe behavior with partial code — acceptable because exact current call sites must be read at execution; interfaces are pinned.

## Review revisions (2026-06-30)

Reviewed by a subagent architect (adversarial) + codex (inconclusive — sandbox blocked its npm/registry probes; it timed out at 7 min). Subagent verdict was **REVISE**; all findings folded in:

- **F1 (BLOCKER)** Ruby 2.6 vs modern fastlane → call **global** `fastlane`/`pod`, no bundler/Gemfile (Tasks 2, 9, 12).
- **F2 (BLOCKER)** New-Arch dead event emitter → `RCTEventEmitter` + `DeviceEventEmitter` (Task 8).
- **F3 (BLOCKER)** metering off → `startRecorder(..., true)` (Task 8).
- **F7 (BLOCKER)** rename fragility → init scaffold **as `Haoji`**, change bundle id only (Task 1).
- **F13 (MAJOR)** `.gitignore` hides native dirs → strip `/ios` `/android` before commit (Task 1).
- **F8 (MAJOR)** fastlane export/signing → manual signing + `export_options` + Distribution cert role note (Task 12).
- **F9 (MAJOR)** path convention → `partPath` & `moveToPart` both `file://`, strip for RNFS (Task 4).
- **F10 (MAJOR)** `react-native-markdown-display` added to `transformIgnorePatterns` (Task 2).
- **F5/F6 (MAJOR)** both RecordScreen tests updated; AnalysisTab drops `isAvailableAsync` guard, `setString` sync (Tasks 5, 6).
- **F4/F14/F15/F16/F17 (MINOR)** singleton note (Task 7), single-listener note + expo-status-bar grep (Tasks 8, 2), dropped stray `react-native.config.js` (Task 1), ASC key role note (Task 12).
