#!/usr/bin/env node
/**
 * End-to-end recording scenarios on a simulator, including the ones that used to need a real phone.
 *
 *   npm run e2e:recording              # build → XCUITest → assert on the audio files
 *   npm run e2e:recording -- --skip-build
 *
 * Two layers of assertion, and both are load-bearing:
 *
 *   screen  ios/HaojiUITests/RecordingInterruptionTests.swift — did it actually pause, did the
 *           elapsed time survive
 *   audio   this script, via ffprobe — is the audio really on disk, at the right length
 *
 * Neither alone is enough. A recording that has been silently deleted still leaves a perfectly
 * convincing UI behind; a screen frozen mid-recording can sit on top of files that are perfectly
 * fine. The bug that cost a release had three separate causes with identical screen symptoms —
 * only the audio told them apart.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = 'com.garyhsieh.haoji';
const WORKSPACE = 'ios/Haoji.xcworkspace';
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o }).trim();

const skipBuild = process.argv.includes('--skip-build');

const device = (() => {
  const booted = sh('xcrun', ['simctl', 'list', 'devices', 'booted']);
  const id = booted.match(/\(([0-9A-F-]{36})\) \(Booted\)/)?.[1];
  if (!id) {
    console.error('沒有開機的模擬器。先跑 ./scripts/sim-setup.sh');
    process.exit(1);
  }
  return id;
})();

/** Every part file the app currently has, with its real duration read back by ffprobe. */
function recordedParts() {
  let container;
  try { container = sh('xcrun', ['simctl', 'get_app_container', device, BUNDLE, 'data']); }
  catch { return []; }
  const docs = join(container, 'Documents', 'haoji');
  if (!existsSync(docs)) return [];

  const out = [];
  for (const sid of readdirSync(docs)) {
    const dir = join(docs, sid);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((n) => /^part-\d+\./.test(n))) {
      const path = join(dir, f);
      let duration = 0, format = '';
      try {
        duration = Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
          '-of', 'default=nw=1:nk=1', path])) || 0;
        format = sh('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
          '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', path]);
      } catch { /* unreadable — duration stays 0, which is itself a finding */ }
      out.push({ sid, name: f, bytes: statSync(path).size, duration, format });
    }
  }
  return out.sort((a, b) => (a.sid + a.name).localeCompare(b.sid + b.name));
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- run the UI tests -----------------------------------------------------------------------
const xcargs = [
  skipBuild ? 'test-without-building' : 'test',
  '-workspace', WORKSPACE, '-scheme', 'Haoji', '-configuration', 'Release',
  '-sdk', 'iphonesimulator', '-destination', `platform=iOS Simulator,id=${device}`,
  '-derivedDataPath', 'ios/build/uitest', 'CODE_SIGNING_ALLOWED=NO',
];

console.log(`模擬器 ${device}`);
console.log(`跑 XCUITest（畫面層）…\n`);
const run = spawnSync('xcodebuild', xcargs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const log = (run.stdout || '') + (run.stderr || '');

for (const m of log.matchAll(/Test Case '-\[[\w.]+ (\w+)\]' (passed|failed)/g)) {
  check(m[1], m[2] === 'passed');
}
// Show why, not just that — the assertion message is the useful part.
for (const m of log.matchAll(/\.swift:\d+: error: -\[[\w.]+ (\w+)\] : (.+)/g)) {
  console.log(`      ${m[1]}: ${m[2].trim()}`);
}
if (!results.length) {
  console.error('沒有跑到任何測試。最後 40 行：');
  console.error(log.split('\n').slice(-40).join('\n'));
  process.exit(1);
}

// --- assert on the audio the tests just produced --------------------------------------------
console.log('\n驗證磁碟上的音檔（ffprobe）…\n');
const parts = recordedParts();
for (const p of parts) {
  console.log(`  ${p.sid}/${p.name}  ${(p.bytes / 1024 / 1024).toFixed(2)} MB  ${p.duration.toFixed(1)}s  (${p.format})`);
}

check('每個段落都是可讀的音檔', parts.length > 0 && parts.every((p) => p.duration > 0),
  parts.length ? `${parts.length} 段` : '磁碟上沒有任何段落');
check('錄音格式是 16 kHz 單聲道', parts.every((p) => p.format === '16000,1'),
  [...new Set(parts.map((p) => p.format))].join(' / ') || '—');
// The interruption tests each record on both sides of a call; anything much shorter means one side
// was lost — which is exactly how the bug presented.
check('中斷前後的音訊都在（每段 > 4 秒）', parts.every((p) => p.duration > 4),
  parts.map((p) => `${p.duration.toFixed(1)}s`).join(', ') || '—');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
