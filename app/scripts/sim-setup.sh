#!/usr/bin/env bash
# One command to get a booted simulator into a known state for testing.
#
#   ./scripts/sim-setup.sh              # build if needed, install, seed, launch
#   ./scripts/sim-setup.sh --rebuild    # force a fresh build first
#   ./scripts/sim-setup.sh --only=appended,broken
#
# Release build on purpose: the JS is bundled into the app, so the simulator needs no Metro and the
# thing under test is what actually ships.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE=com.garyhsieh.haoji
APP_PATH="ios/build/sim/Build/Products/Release-iphonesimulator/Haoji.app"

DEVICE=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1 || true)
[ -n "$DEVICE" ] || { echo "沒有開機的模擬器。先開一台（Simulator.app）再試。"; exit 1; }

REBUILD=0; ONLY=""
for a in "$@"; do
  case "$a" in
    --rebuild) REBUILD=1 ;;
    --only=*)  ONLY="$a" ;;
  esac
done

if [ "$REBUILD" = 1 ] || [ ! -d "$APP_PATH" ]; then
  echo "▸ 建置模擬器版本（Release，約 3–6 分鐘）…"
  ( cd ios && xcodebuild -workspace Haoji.xcworkspace -scheme Haoji \
      -configuration Release -sdk iphonesimulator \
      -destination "platform=iOS Simulator,id=$DEVICE" \
      -derivedDataPath build/sim CODE_SIGNING_ALLOWED=NO build ) >/tmp/haoji-sim-build.log 2>&1 \
    || { echo "建置失敗，詳見 /tmp/haoji-sim-build.log"; tail -20 /tmp/haoji-sim-build.log; exit 1; }
fi

# Reinstall from scratch: an install over a half-built app is how you get a dyld crash at launch.
echo "▸ 安裝到模擬器…"
xcrun simctl uninstall "$DEVICE" "$BUNDLE" >/dev/null 2>&1 || true
xcrun simctl install "$DEVICE" "$APP_PATH"

echo "▸ 灌入測試資料…"
node scripts/seed-sim.mjs ${ONLY:+"$ONLY"}

echo "▸ 啟動…"
xcrun simctl terminate "$DEVICE" "$BUNDLE" >/dev/null 2>&1 || true
xcrun simctl launch "$DEVICE" "$BUNDLE" >/dev/null
echo "✅ 就緒。情境清單：node scripts/seed-sim.mjs --list"
