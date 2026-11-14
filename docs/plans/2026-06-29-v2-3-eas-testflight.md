# 好記 v2-3 — EAS native config + TestFlight runbook

> **For agentic workers:** this plan is a guided runbook, not a TDD plan. Build/submit steps need interactive Apple/Expo auth the controller cannot perform; those are marked **[YOU]**. Config steps the agent prepares are **[AGENT]**. "Done" = the build installs from TestFlight and the end-to-end flow works over Tailscale.

**Goal:** Turn the Expo app into an iOS build distributable via TestFlight, with the native entitlements that make background recording work and an ATS exception so the app can reach the Tailscale backend over http.

**Tech Stack:** Expo SDK 54, EAS CLI, App Store Connect API key, TestFlight.

## Global Constants (verbatim)

- Bundle identifier: `com.garyhsieh.haoji`
- Apple Team ID: `64N77Z6TV3`
- App Store Connect API key: `%USERPROFILE%\Downloads\AuthKey_<ASC_KEY_ID>.p8` (Key ID `<ASC_KEY_ID>`, Issuer ID `<ASC_ISSUER_ID>`)
- App backend (Tailscale): `http://<tailscale-ip>:8780` → `EXPO_PUBLIC_API_BASE`
- The `.p8` is a SECRET: never commit it; reference by path only. Add `*.p8` to `.gitignore`.

---

### Step 1 [AGENT]: Native config in `app/app.json`

Set the iOS native config. Merge into `app.json` `expo` block:

```json
{
  "expo": {
    "name": "好記",
    "slug": "haoji",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.garyhsieh.haoji",
      "buildNumber": "1",
      "supportsTablet": false,
      "infoPlist": {
        "NSMicrophoneUsageDescription": "好記需要麥克風來錄製會議音訊。",
        "UIBackgroundModes": ["audio"],
        "NSAppTransportSecurity": {
          "NSExceptionDomains": {
            "<tailscale-ip>": {
              "NSExceptionAllowsInsecureHTTPLoads": true,
              "NSIncludesSubdomains": false
            }
          }
        }
      }
    }
  }
}
```

Verify: `cd app && npx expo config --type public | grep -i bundleIdentifier` shows `com.garyhsieh.haoji`. Commit.

---

### Step 2 [AGENT]: `eas.json` build + submit profiles

Install + init: `cd app && npm install --save-dev eas-cli` (or use `npx eas-cli`). Create `app/eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "production": {
      "ios": { "distribution": "store", "autoIncrement": true },
      "env": { "EXPO_PUBLIC_API_BASE": "http://<tailscale-ip>:8780" }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascApiKeyPath": "%USERPROFILE%/Downloads/AuthKey_<ASC_KEY_ID>.p8",
        "ascApiKeyId": "<ASC_KEY_ID>",
        "ascApiKeyIssuerId": "<ASC_ISSUER_ID>",
        "appleTeamId": "64N77Z6TV3"
      }
    }
  }
}
```

Add `*.p8` to `app/.gitignore` (and repo root). Commit `eas.json` + gitignore (NOT the .p8).

---

### Step 3 [YOU]: Expo account + login

In a terminal at `D:\projects\haoji\app`:

```
npx eas-cli login
```

(Create a free Expo account first at expo.dev if you don't have one.) Then:

```
npx eas-cli whoami
```

confirms you're logged in. Tell me when done.

---

### Step 4 [YOU + AGENT]: iOS credentials (cert + provisioning profile)

EAS needs an Apple Distribution certificate + a provisioning profile for `com.garyhsieh.haoji`. Easiest path — let EAS generate them using your Apple account:

```
npx eas-cli build:configure
npx eas-cli credentials
```

When prompted: platform **iOS**, profile **production**, let EAS **create** the Distribution Certificate and Provisioning Profile. You'll authenticate with your **Apple ID + 2FA** (this is the interactive part I can't do). The App ID `com.garyhsieh.haoji` will be registered on your account automatically.

If it asks about an App Store Connect app record and it doesn't exist yet, allow EAS to create it (or create it manually in App Store Connect → Apps → + → bundle id `com.garyhsieh.haoji`, name 好記).

---

### Step 5 [YOU]: First iOS build

```
npx eas-cli build --platform ios --profile production
```

Runs in Expo's cloud (~15–25 min). It uses the `EXPO_PUBLIC_API_BASE` from `eas.json` so the build talks to your Tailscale backend. When it finishes you get a build URL. Tell me the build succeeded (or paste any error — I'll read and fix config).

---

### Step 6 [YOU]: Submit to TestFlight

```
npx eas-cli submit --platform ios --profile production --latest
```

This uploads the build to App Store Connect using the `.p8` API key (no Apple password needed for submit). After ~5–15 min of Apple processing, the build appears in **App Store Connect → your app → TestFlight**.

---

### Step 7 [YOU]: Install via TestFlight + test

1. Install the **TestFlight** app on your iPhone from the App Store.
2. As the account holder you're automatically an internal tester — the build shows up in TestFlight. Install it.
3. Make sure **Tailscale is running on the phone** (same tailnet) so it reaches `<tailscale-ip>:8780`.
4. Make sure the **backend is running** on the PC (`cd backend && python app.py`) and Breeze ASR + Ollama are up.
5. Walk the flow: record (try locking the screen / a phone call mid-record → background keeps recording / resume prompt), see raw recordings, analyze, tap-edit speakers, Markdown notes, unlock (dev stub).

---

### Pre-flight checks the AGENT can do before your build

- `cd app && npx expo config --type public` parses without error and shows the bundle id + infoPlist.
- `npx expo-doctor` (if available) reports no blocking issues.
- `npm test` still green (native config doesn't affect jest).
- Confirm `*.p8` is gitignored and not staged.

## Verification / Done criteria

- `eas build` succeeds and `eas submit` lands the build in TestFlight.
- The TestFlight app installs on your iPhone and, with Tailscale on, completes the full record→analyze→notes flow against the home backend — including from a non-home network.
- Background recording continues when the screen locks / app backgrounds (this only works because of `UIBackgroundModes: audio` in this build — it never worked in Expo Go).

## Notes / gotchas

- **ATS**: the exception is scoped to the Tailscale IP only (not arbitrary loads), which Apple accepts. If you later move the backend to a real https domain, drop the exception.
- **buildNumber**: `autoIncrement` bumps it each build; if a submit is rejected for a duplicate build number, rebuild.
- **IAP** is still a dev stub this round — App Store may note missing IAP metadata; for TestFlight internal testing that's fine. Real IAP = B3.
- If `eas build` complains about the SDK 54 / RN 0.81 native version, run `npx expo install --check` and fix before rebuilding.
