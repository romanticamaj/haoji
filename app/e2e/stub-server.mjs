#!/usr/bin/env node
// A tiny stand-in for the Haoji server, for cross-platform UI e2e (Maestro) without a GPU.
// Serves the shared contract fixtures for /api/status and fakes the session pipeline with a canned
// transcript, so "record → 生成逐字稿 → transcript" runs end to end on a simulator/emulator.
//   node e2e/stub-server.mjs [port=7799]
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const contracts = path.join(here, '../../backend/tests/fixtures/contracts');
const fixture = (n) => JSON.parse(readFileSync(path.join(contracts, n), 'utf8'));
const PORT = Number(process.argv[2] || process.env.PORT || 7799);
const TOKEN = process.env.STUB_TOKEN || ''; // when set, /api/sessions* requires it (pairing test)

const status = { ...fixture('status.json'), ok: true, queue: { active: 0, queued: 0 } };
status.checks = status.checks.map((c) => ({ ...c, ok: true, hint: '' }));

export const TRANSCRIPT = {
  segments: [
    { start: 0, end: 4.2, speaker: 'SPEAKER_00', text: '今天主要確認下一季的產品方向。' },
    { start: 4.2, end: 9.8, speaker: 'SPEAKER_01', text: '我這邊補充一下時程，預計三月上線。' },
    { start: 9.8, end: 14.0, speaker: 'SPEAKER_00', text: '好，那我們就照這個排。' },
  ],
  speakers: ['SPEAKER_00', 'SPEAKER_01'],
  duration: 14.0,
  stats: [
    { speaker: 'SPEAKER_00', seconds: 8.4, segments: 2 },
    { speaker: 'SPEAKER_01', seconds: 5.6, segments: 1 },
  ],
};
const NOTES = '# 下一季產品方向\n\n## 會議摘要\n- 確認下一季方向，三月上線。\n\n## 待辦事項\n- SPEAKER_01：整理時程。';

const sessions = new Map(); // id -> {polls, notes}
let seq = 0;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function drain(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const body = await drain(req);
  if (process.env.STUB_LOG) console.log(req.method, p);

  if (p === '/health') return send(res, 200, { status: 'ok', service: 'haoji-backend' });
  if (p === '/api/status') return send(res, 200, status);

  if (p.startsWith('/api/sessions')) {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(res, 401, { error: { code: 'unauthorized', message: '配對金鑰不對。', hint: '' } });
    }
    if (req.method === 'POST' && p === '/api/sessions') {
      const id = `stub${String(++seq).padStart(4, '0')}`;
      sessions.set(id, { polls: 0, notes: null });
      return send(res, 200, { session_id: id });
    }
    const m = p.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
    const s = m && sessions.get(m[1]);
    if (!s) return send(res, 404, { error: '查無此工作' });
    const rest = m[2] || '';
    if (rest.startsWith('/parts')) return send(res, 200, { count: 1, transcribe_started: false });
    if (rest === '/transcribe') return send(res, 200, { ok: true });
    if (rest === '/analyze') {
      s.notes = NOTES;
      return send(res, 200, { ok: true, background: true });
    }
    if (req.method === 'DELETE') { sessions.delete(m[1]); return send(res, 200, { ok: true }); }
    // GET: two polls of progress, then done
    s.polls += 1;
    if (s.polls < 3) return send(res, 200, { status: 'running', pct: 0.3 * s.polls, message: '辨識中（含講者分離）…' });
    const out = { status: 'done', pct: 1, message: '完成', transcript: TRANSCRIPT };
    if (s.notes) Object.assign(out, { notes: s.notes, notes_status: 'done' });
    return send(res, 200, out);
  }
  send(res, 404, { error: { code: 'not_found', message: 'not found', hint: '' } });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '0.0.0.0', () => console.log(`haoji stub server on :${PORT}`));
}
export default server;
