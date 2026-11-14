# Bare React Native (no Expo)

This app was ejected from Expo to a standard `@react-native-community/cli` project
(see `docs/plans/2026-06-30-eject-expo-to-bare-rn.md`). Pinned to **React Native 0.81.5 /
React 19.1.0**, New Architecture **on**. There is no Expo layer — do not add `expo*` packages.

- Verify RN APIs against the RN 0.81 docs, not memory; New-Arch native modules need codegen/Nitro.
- After changing native deps: `cd ios && pod install` (global CocoaPods, not `bundle exec` —
  system Ruby is 2.6).
- Native module gotcha: JS↔native events use an `RCTEventEmitter` subclass + `DeviceEventEmitter`
  (see `ios/Haoji/AudioInterruption.swift`), never `NativeEventEmitter(NativeModules.X)` (undefined
  under New Arch).
- Jest: `preset: 'react-native'`; native modules are mocked in `jest-setup.js` / per-suite.
- TestFlight: `cd ios && fastlane beta` (App Store Connect API key; manual signing).
