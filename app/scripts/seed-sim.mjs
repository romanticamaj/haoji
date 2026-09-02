#!/usr/bin/env node
/**
 * Seed the booted simulator with known fixtures, so every scenario we keep re-testing by hand can be
 * reproduced in one command.
 *
 *   node scripts/seed-sim.mjs            # seed everything
 *   node scripts/seed-sim.mjs --list     # show the scenarios
 *   node scripts/seed-sim.mjs --only=appended,broken
 *
 * It writes REAL audio (generated with ffmpeg) into the app's Documents dir and a matching
 * haoji.sessions entry into AsyncStorage — fake paths would pass a list screen and fail the moment
 * anything tried to play or upload them, which is exactly where the bugs have been.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUNDLE = 'com.garyhsieh.haoji';
const STORE_KEY = 'haoji.sessions';
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

// --- simulator plumbing -----------------------------------------------------------------------
function bootedDevice() {
  const out = sh('xcrun', ['simctl', 'list', 'devices', 'booted']);
  const id = out.match(/\(([0-9A-F-]{36})\) \(Booted\)/)?.[1];
  if (!id) throw new Error('沒有開機的模擬器。先開一台，再跑一次。');
  return id;
}
function appContainer(device) {
  try { return sh('xcrun', ['simctl', 'get_app_container', device, BUNDLE, 'data']); }
  catch { throw new Error(`模擬器上找不到 ${BUNDLE}。先安裝 App（見 scripts/README-sim.md）。`); }
}

// --- fixtures ---------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'haoji-seed-'));
/** A real WAV at the app's own recording settings (16 kHz mono PCM), so merging/playing behave. */
function wav(seconds, freq = 440) {
  const out = join(tmp, `w-${seconds}-${freq}.wav`);
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:duration=${seconds}`,
      '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', out]);
  }
  return out;
}
function m4a(seconds, freq = 440) {
  const out = join(tmp, `m-${seconds}-${freq}.m4a`);
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:duration=${seconds}`, '-c:a', 'aac', out]);
  }
  return out;
}
/** An .m4a truncated so its moov index is missing — the unrecoverable crash file. */
function brokenM4a() {
  const src = m4a(5, 300);
  const out = join(tmp, 'broken.m4a');
  const buf = readFileSync(src);
  writeFileSync(out, buf.subarray(0, Math.floor(buf.length * 0.6)));
  return out;
}
/** A WAV whose header lengths were never written back — the recoverable crash file. */
function unclosedWav() {
  const src = wav(4, 520);
  const out = join(tmp, 'unclosed.wav');
  const buf = readFileSync(src);
  buf.writeUInt32LE(0, 4);                       // RIFF size
  const data = buf.indexOf(Buffer.from('data'));
  if (data > 0) buf.writeUInt32LE(0, data + 4);  // data size
  writeFileSync(out, buf);
  return out;
}

const transcript = (texts) => ({
  speakers: ['SPEAKER_00', 'SPEAKER_01'],
  segments: texts.map((text, i) => ({
    start: i * 4, end: i * 4 + 3.5, speaker: i % 2 ? 'SPEAKER_01' : 'SPEAKER_00', text,
  })),
});
// The case the speaker sheet exists for: diarisation finds far more people than anyone wants to
// hunt through a transcript for. Speaking time is deliberately lopsided — two people carry the
// meeting and the rest drop one line each — so the ranking has something real to sort.
const manySpeakers = () => {
  const n = 9;
  const speakers = Array.from({ length: n }, (_, i) => `SPEAKER_0${i}`);
  const segments = [];
  let t = 0;
  const say = (i, secs, text) => { segments.push({ start: t, end: t + secs, speaker: speakers[i], text }); t += secs; };
  say(0, 40, '今天主要確認下一季的方向');
  say(1, 25, '我這邊補充一下時程');
  say(0, 35, '那我們就照這個排');
  for (let i = 2; i < n; i++) say(i, 3 + i * 0.5, `第 ${i + 1} 位講者的一句話`);
  say(1, 20, '好，那就這樣定案');
  return { speakers, segments };
};

const NOTES = '# 會議記錄：產品方向討論\n\n## 會議摘要\n\n- 確認下一季的產品方向與時程。\n\n## 討論重點\n\n- 先做原型驗證\n\n## 待辦事項\n\n- [ ] 彙整需求\n';
const day = (n) => Date.now() - n * 86400000;

/** Each scenario: the store entry plus the real files it needs on disk. */
const SCENARIOS = {
  fresh: {
    why: '錄好但還沒生成逐字稿 → 應顯示「生成逐字稿」',
    session: (id) => ({ id, createdAt: day(0), title: '新錄音（未生成）', names: {}, unlocked: false,
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 6000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(6)]],
  },
  manyspeakers: {
    why: '9 位講者 → 測「講者 N/M」彈窗：依說話時間排序、一次命名多人、清單可捲動不被完成鍵擋住',
    session: (id) => ({ id, createdAt: day(0), title: '跨部門週會（9 位講者）', names: {}, unlocked: false,
      transcript: manySpeakers(), backendId: 'seed-backend-many',
      job: { stage: 'done', uploaded: 1, pct: 1, message: '完成', updatedAt: day(0) },
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 150000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(20, 480)]],
  },
  analysed: {
    why: '已有逐字稿與會議記錄 → 測編輯、複製、關鍵字取代、版本紀錄',
    session: (id) => ({ id, createdAt: day(1), title: '產品方向討論', names: { SPEAKER_00: 'Gary' },
      unlocked: true, transcript: transcript(['我們先確認方向', '好，我同意', '那就先做原型']),
      notes: NOTES, backendId: 'seed-backend-analysed',
      job: { stage: 'done', uploaded: 1, pct: 1, message: '完成', updatedAt: day(1) },
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 12000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(12, 660)]],
  },
  appended: {
    why: '已分析過又補錄 → 重新生成逐字稿「不應一進去就跳出」(build 63 修的)',
    session: (id) => ({ id, createdAt: day(1), title: '補錄過的會議', names: {}, unlocked: true,
      transcript: transcript(['這是補錄前的內容']), notes: NOTES, backendId: 'seed-backend-stale',
      job: { stage: 'done', uploaded: 1, pct: 1, message: '完成', updatedAt: day(1) },
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 18000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(18, 400)]],
  },
  multipart: {
    why: '多段未合併（舊資料）→ 播放器應能跨段跳轉；匯出應可用',
    session: (id) => ({ id, createdAt: day(2), title: '多段錄音（未合併）', names: {}, unlocked: false,
      parts: [
        { uri: `haoji/${id}/part-0.wav`, durationMs: 5000 },
        { uri: `haoji/${id}/part-1.wav`, durationMs: 4000 },
        { uri: `haoji/${id}/part-2.wav`, durationMs: 3000 },
      ] }),
    files: (id) => [
      [`haoji/${id}/part-0.wav`, wav(5, 440)],
      [`haoji/${id}/part-1.wav`, wav(4, 550)],
      [`haoji/${id}/part-2.wav`, wav(3, 660)],
    ],
  },
  broken: {
    why: '中斷留下的 m4a（索引缺失）→ 應顯示無法播放，且說明不可修復',
    session: (id) => ({ id, createdAt: day(3), title: '損毀音檔（m4a）', names: {}, unlocked: false,
      parts: [{ uri: `haoji/${id}/part-0.m4a`, durationMs: 5000 }] }),
    files: (id) => [[`haoji/${id}/part-0.m4a`, brokenM4a()]],
  },
  unclosed: {
    why: 'WAV 檔頭長度未回填 → 開 App 應自動修復並可播放',
    session: (id) => ({ id, createdAt: day(3), title: '未收尾的錄音（WAV）', names: {}, unlocked: false,
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 4000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, unclosedWav()]],
  },
  orphan: {
    why: '磁碟上有錄音但 store 沒紀錄 → 開 App 應復原成「已復原的錄音」',
    session: null,                                   // deliberately NOT in the store
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(7, 480)]],
  },
  longtitle: {
    why: '長標題 + 未生成記錄 → 版面不應被撐爆',
    session: (id) => ({ id, createdAt: day(4),
      title: '關於下一季度產品發展方向、預算配置與人力調度的跨部門協調會議', names: {}, unlocked: false,
      transcript: transcript(['第一段內容', '第二段內容']),
      parts: [{ uri: `haoji/${id}/part-0.wav`, durationMs: 9000 }] }),
    files: (id) => [[`haoji/${id}/part-0.wav`, wav(9, 700)]],
  },
};

// --- run --------------------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const [name, s] of Object.entries(SCENARIOS)) console.log(`  ${name.padEnd(12)} ${s.why}`);
  process.exit(0);
}
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
const chosen = Object.entries(SCENARIOS).filter(([n]) => !only || only.includes(n));
if (chosen.length === 0) throw new Error(`--only 沒有對到任何情境。可用：${Object.keys(SCENARIOS).join(', ')}`);

const device = bootedDevice();
const container = appContainer(device);
const docs = join(container, 'Documents');

console.log(`模擬器 ${device}`);
console.log(`容器   ${container}\n`);

const store = {};
for (const [name, sc] of chosen) {
  const id = `seed-${name}`;
  for (const [rel, src] of sc.files(id)) {
    const dest = join(docs, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, readFileSync(src));
  }
  if (sc.session) store[id] = sc.session(id);
  console.log(`  ✓ ${name.padEnd(12)} ${sc.why}`);
}

// AsyncStorage keeps a small value inline in the manifest and a big one in a side file; write both
// consistently so the app reads exactly what we intended.
const asDir = join(container, 'Library', 'Application Support', BUNDLE, 'RCTAsyncLocalStorage_V1');
mkdirSync(asDir, { recursive: true });
const json = JSON.stringify(store);
const hash = execFileSync('/bin/sh', ['-c', `printf %s '${STORE_KEY}' | md5`]).toString().trim();
writeFileSync(join(asDir, hash), json);
writeFileSync(join(asDir, 'manifest.json'), JSON.stringify({ [STORE_KEY]: null }));

rmSync(tmp, { recursive: true, force: true });
console.log(`\n已寫入 ${Object.keys(store).length} 筆 session（另有 orphan 僅放檔案）。`);
console.log('重新啟動 App 以載入：');
console.log(`  xcrun simctl terminate ${device} ${BUNDLE}; xcrun simctl launch ${device} ${BUNDLE}`);
