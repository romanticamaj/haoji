/**
 * @jest-environment node
 */
// The Maestro stub must keep speaking the same contract as the real server, or device e2e fails for
// reasons that have nothing to do with the app. Runs the stub as a child process and talks HTTP to it.
const { spawn } = require('child_process');
const path = require('path');

const PORT = 17799 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${PORT}`;
let proc;

beforeAll(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'stub-server.mjs'), String(PORT)], {
    env: { ...process.env, STUB_TOKEN: 'e2e' },
    stdio: 'ignore', // piped stdio keeps handles open and jest never exits on CI
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('stub did not start');
});
afterAll(async () => {
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await exited;
});

const auth = { Authorization: 'Bearer e2e' };

test('status matches the public contract and is all green', async () => {
  const contract = require('../../../backend/tests/fixtures/contracts/status.json');
  const s = await (await fetch(`${base}/api/status`)).json();
  expect(Object.keys(s).sort()).toEqual(Object.keys(contract).sort());
  expect(s.ok).toBe(true);
  expect(s.checks.every((c) => c.ok)).toBe(true);
});

test('sessions require the pairing token when one is set', async () => {
  expect((await fetch(`${base}/api/sessions`, { method: 'POST' })).status).toBe(401);
});

test('pipeline: create → parts → transcribe → running twice → done with transcript; notes later', async () => {
  const { session_id } = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: auth })).json();
  expect(session_id).toMatch(/^stub/);
  expect((await fetch(`${base}/api/sessions/${session_id}/parts?index=0`, { method: 'POST', headers: auth, body: 'x' })).ok).toBe(true);
  expect((await fetch(`${base}/api/sessions/${session_id}/transcribe`, { method: 'POST', headers: auth })).ok).toBe(true);
  const poll = async () => (await fetch(`${base}/api/sessions/${session_id}`, { headers: auth })).json();
  expect((await poll()).status).toBe('running');
  expect((await poll()).status).toBe('running');
  const done = await poll();
  expect(done.status).toBe('done');
  expect(done.transcript.segments[0].text).toBe('今天主要確認下一季的產品方向。');
  await fetch(`${base}/api/sessions/${session_id}/analyze`, { method: 'POST', headers: auth, body: '{}' });
  expect((await poll()).notes).toContain('# 下一季產品方向');
  expect((await fetch(`${base}/api/sessions/${session_id}`, { method: 'DELETE', headers: auth })).ok).toBe(true);
  expect((await fetch(`${base}/api/sessions/${session_id}`, { headers: auth })).status).toBe(404);
});
