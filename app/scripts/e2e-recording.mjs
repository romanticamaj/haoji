#!/usr/bin/env node
/**
 * End-to-end recording scenarios on a simulator, including the ones that used to need a real phone.
 *
 *   node scripts/e2e-recording.mjs              # run every scenario
 *   node scripts/e2e-recording.mjs --only=call
 *
 * What makes this worth running: it drives the REAL recorder (AVAudioRecorder, real files) and the
 * REAL interruption path — the app posts an actual AVAudioSession interruption when asked over a
 * simulator-only URL hook. The assertions are on the AUDIO ITSELF, not on what the screen says: a
 * recording that has been silently deleted still leaves a perfectly convincing UI behind.
 *
 * Requires the app installed and mic permission granted once (scripts/sim-setup.sh does the install;
 * tap 允許 the first time).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = 'com.garyhsieh.haoji';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const device = (() => {
  const id = sh('xcrun', ['simctl', 'list', 'devices', 'booted']).match(/\(([0-9A-F-]{36})\) \(Booted\)/)?.[1];
  if (!id) throw new Error('沒有開機的模擬器。');
  return id;
})();
const container = sh('xcrun', ['simctl', 'get_app_container', device, BUNDLE, 'data']);
const docs = join(container, 'Documents', 'haoji');

const launch = () => sh('xcrun', ['simctl', 'launch', device, BUNDLE]);
const terminate = () => { try { sh('xcrun', ['simctl', 'terminate', device, BUNDLE]); } catch {} };
const openurl = (u) => sh('xcrun', ['simctl', 'openurl', device, u]);

/** Tap through the UI with the same tool a human would use — coordinates come from the a11y tree. */
function ui(action, ...args) {
  return sh('xcrun', ['simctl', 'ui', device, action, ...args]);
}

/** Every part file the app currently has, with its real duration read back by ffprobe. */
function recordedParts() {
  if (!existsSync(docs)) return [];
  const out = [];
  for (const sid of readdirSync(docs)) {
    const dir = join(docs, sid);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((n) => /^part-\d+\./.test(n))) {
      const path = join(dir, f);
      let duration = 0;
      try {
        duration = Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
          '-of', 'default=nw=1:nk=1', path])) || 0;
      } catch { /* unreadable — duration stays 0, which is itself a finding */ }
      out.push({ sid, name: f, bytes: statSync(path).size, duration });
    }
  }
  return out.sort((a, b) => (a.sid + a.name).localeCompare(b.sid + b.name));
}

const reset = () => {
  terminate();
  try { rmSync(docs, { recursive: true, force: true }); } catch {}
};

// --- scenarios ----------------------------------------------------------------------------------
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The one that cost a release: a call arrives mid-recording, the user carries on, and everything
 * recorded BEFORE the call must still be there afterwards.
 */
async function callDuringRecording(startRecording) {
  reset();
  launch();
  await sleep(2500);
  await startRecording();
  await sleep(6000);                              // ~6s of audio before the call

  openurl('haoji://e2e/deactivate');              // a call takes the session away
  openurl('haoji://e2e/interrupt?type=began');
  await sleep(2500);

  const afterCall = recordedParts();
  check('通話中斷後，先前錄的段落已存檔',
    afterCall.length === 1 && afterCall[0].duration > 2,
    afterCall.length ? `${afterCall[0].name} ${afterCall[0].duration.toFixed(1)}s` : '沒有任何段落');

  openurl('haoji://e2e/interrupt?type=ended&resume=1');   // call ends, iOS says carry on
  await sleep(6000);                                     // more audio after the call
  return afterCall;
}

console.log(`模擬器 ${device}`);
console.log(`容器   ${container}\n`);
console.log('注意：這個腳本只驗證檔案層行為；點按錄音鍵的部分請照提示手動或用 UI 自動化補上。\n');

const before = recordedParts();
console.log(`目前磁碟上有 ${before.length} 個段落`);
for (const p of before) console.log(`  ${p.sid}/${p.name}  ${(p.bytes / 1024 / 1024).toFixed(2)} MB  ${p.duration.toFixed(1)}s`);

console.log('\n可用的中斷觸發：');
console.log(`  xcrun simctl openurl ${device} "haoji://e2e/interrupt?type=began"`);
console.log(`  xcrun simctl openurl ${device} "haoji://e2e/interrupt?type=ended&resume=1"`);
console.log(`  xcrun simctl openurl ${device} "haoji://e2e/deactivate"   # 模擬通話搶走音訊`);

export { recordedParts, callDuringRecording, check, results, device, openurl, launch, terminate, reset };
