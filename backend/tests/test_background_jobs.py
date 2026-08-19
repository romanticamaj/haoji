"""Background-job behaviour: the server must be able to finish the work with the client gone.

Two things make that possible:
  * expected_parts → the server starts transcription itself once every part has landed, so an upload
    completed by the OS (background URLSession, app closed) still gets processed.
  * background analyze → notes generation is queued and the result stored, so a client that is
    backgrounded or killed mid-generation collects it later instead of paying for a second LLM run.
"""
import json, time
import pytest
from fastapi.testclient import TestClient
import app as appmod, sessions


@pytest.fixture(autouse=True)
def _reset_module_state():
    """app.py keeps in-flight/queued sets at module level, so one test's leftovers would otherwise
    leak into the next (a test that stubs out submit never lets the worker drain the queue)."""
    appmod._notes_waiting.clear()
    appmod._analyzing.clear()
    appmod._submitted.clear()
    yield
    appmod._notes_waiting.clear()
    appmod._analyzing.clear()
    appmod._submitted.clear()


def _db(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(appmod, "PARTS_DIR", str(tmp_path / "parts"))
    (tmp_path / "parts").mkdir(exist_ok=True)
    sessions.init_db()


def test_create_session_records_expected_parts(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={"client_id": "local-1", "expected_parts": 2}).json()["session_id"]
    assert sessions.get_session(sid)["expected_parts"] == 2
    # reusing the same client_id keeps ONE session and can still learn the count
    again = c.post("/api/sessions", json={"client_id": "local-1", "expected_parts": 2}).json()
    assert again["session_id"] == sid and again["reused"] is True


def test_transcription_auto_starts_only_once_every_expected_part_arrived(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    started = []
    monkeypatch.setattr(appmod, "_submit_transcribe", lambda sid: (started.append(sid), True)[1])
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={"expected_parts": 2}).json()["session_id"]

    r1 = c.post(f"/api/sessions/{sid}/parts?index=0", files={"file": ("p0.wav", b"aaa", "audio/wav")})
    assert r1.json()["transcribe_started"] is False          # still waiting for part 1
    assert started == []

    r2 = c.post(f"/api/sessions/{sid}/parts?index=1", files={"file": ("p1.wav", b"bbb", "audio/wav")})
    assert r2.json()["transcribe_started"] is True           # last part in → server starts it itself
    assert started == [sid]


def test_no_expected_parts_means_no_auto_start(tmp_path, monkeypatch):
    """Older clients (which call /transcribe themselves) must keep the old behaviour."""
    _db(tmp_path, monkeypatch)
    started = []
    monkeypatch.setattr(appmod, "_submit_transcribe", lambda sid: (started.append(sid), True)[1])
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={}).json()["session_id"]
    r = c.post(f"/api/sessions/{sid}/parts?index=0", files={"file": ("p0.wav", b"aaa", "audio/wav")})
    assert r.json()["transcribe_started"] is False
    assert started == []


def _seed_transcript(sid):
    sessions.update_session(sid, status="done", transcript=json.dumps(
        {"segments": [{"start": 0, "end": 2, "speaker": "SPEAKER_00", "text": "今天開會"}],
         "speakers": ["SPEAKER_00"]}))


def test_background_analyze_returns_immediately_and_stores_the_notes(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())

    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={"background": True})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "background": True}      # no notes in the response — it's a job

    for _ in range(100):                                     # let the worker finish
        if sessions.get_session(sid)["notes_status"] == "done":
            break
        time.sleep(0.02)

    # the client can now collect the result from the status endpoint, even after being killed
    st = c.get(f"/api/sessions/{sid}").json()
    assert st["notes_status"] == "done"
    assert st["notes"].startswith("## 會議摘要")


def test_background_analyze_records_failure_instead_of_hanging(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)

    class Boom:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            raise RuntimeError("LLM 沒開")
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": Boom())

    c = TestClient(appmod.app)
    c.post(f"/api/sessions/{sid}/analyze", json={"background": True})
    for _ in range(100):
        if sessions.get_session(sid)["notes_status"] == "error":
            break
        time.sleep(0.02)
    st = c.get(f"/api/sessions/{sid}").json()
    assert st["notes_status"] == "error"
    assert "LLM 沒開" in st["notes_error"]


def test_synchronous_analyze_still_works(tmp_path, monkeypatch):
    """Builds already in the wild call /analyze without `background` and expect the notes back."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            return "## 會議摘要\n同步"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())

    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={})
    assert r.status_code == 200
    assert r.json()["notes"].endswith("同步")


def test_put_part_stores_bytes_and_is_idempotent_by_index(tmp_path, monkeypatch):
    """The raw-body route used by iOS background uploads."""
    _db(tmp_path, monkeypatch)
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={}).json()["session_id"]

    r = c.put(f"/api/sessions/{sid}/parts/0", content=b"hello-audio")
    assert r.status_code == 200 and r.json()["count"] == 1
    # re-sending the same index overwrites rather than appending (a retried upload can't duplicate)
    r = c.put(f"/api/sessions/{sid}/parts/0", content=b"hello-audio-again")
    assert r.json()["count"] == 1
    path = sessions.get_parts(sid)[0]
    assert open(path, "rb").read() == b"hello-audio-again"


def test_put_part_auto_starts_transcription_on_the_last_expected_part(tmp_path, monkeypatch):
    """The whole point: the OS can finish the upload with the app closed and the job still runs."""
    _db(tmp_path, monkeypatch)
    started = []
    monkeypatch.setattr(appmod, "_submit_transcribe", lambda sid: (started.append(sid), True)[1])
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={"expected_parts": 2}).json()["session_id"]

    assert c.put(f"/api/sessions/{sid}/parts/0", content=b"aaa").json()["transcribe_started"] is False
    assert c.put(f"/api/sessions/{sid}/parts/1", content=b"bbb").json()["transcribe_started"] is True
    assert started == [sid]


def test_put_part_rejects_an_empty_body(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={}).json()["session_id"]
    assert c.put(f"/api/sessions/{sid}/parts/0", content=b"").status_code == 400
    assert sessions.get_parts(sid) == []


def test_analyze_uses_the_transcript_the_CLIENT_sends(tmp_path, monkeypatch):
    """The phone is the source of truth: it holds the user's corrections and still has the transcript
    when the server copy is long gone. Sending it means notes are generated from the CORRECTED text."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")          # NOTE: no transcript stored server-side at all
    seen = {}

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            seen["text"] = transcript
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())

    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={
        "names": {"SPEAKER_00": "Gary"},
        "transcript": {"speakers": ["SPEAKER_00"],
                       "segments": [{"start": 0, "end": 2, "speaker": "SPEAKER_00", "text": "改過的內容"}]},
    })
    assert r.status_code == 200                      # would have been 404 查無逐字稿 before
    assert "Gary: 改過的內容" in seen["text"]


def test_analyze_still_falls_back_to_the_stored_transcript(tmp_path, monkeypatch):
    """Older builds don't send one."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())
    c = TestClient(appmod.app)
    assert c.post(f"/api/sessions/{sid}/analyze", json={}).status_code == 200


def test_analyze_404s_only_when_there_is_no_transcript_anywhere(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={})
    assert r.status_code == 404 and r.json()["error"] == "查無逐字稿"


def test_notes_generation_does_not_share_the_transcription_pool(tmp_path, monkeypatch):
    """A couple of long transcriptions used to starve every later notes job — it just sat in the
    queue looking hung. The pools are separate now."""
    assert appmod._notes_executor is not appmod._executor


def test_debug_jobs_reports_what_the_server_is_working_on(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    c = TestClient(appmod.app)
    j = c.get("/api/debug/jobs").json()
    assert set(j) == {"transcribe", "notes"}
    for k in ("in_flight", "workers", "queued"):
        assert k in j["transcribe"] and k in j["notes"]


def test_analyze_works_for_a_session_the_server_has_never_seen(tmp_path, monkeypatch):
    """The exact '查無此工作' report: the phone's stored id is gone (redeploy / DB reset / pruning)
    but it still holds the transcript. Notes are a pure function of what the client sends, so the
    row is created on demand just to hold the result."""
    _db(tmp_path, monkeypatch)

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())

    c = TestClient(appmod.app)
    unknown = "totally-unknown-id"
    assert sessions.get_session(unknown) is None

    r = c.post(f"/api/sessions/{unknown}/analyze", json={
        "background": True,
        "transcript": {"speakers": ["SPEAKER_00"],
                       "segments": [{"start": 0, "end": 2, "speaker": "SPEAKER_00", "text": "內容"}]},
    })
    assert r.status_code == 200                      # was 404 查無此工作

    for _ in range(100):
        s = sessions.get_session(unknown)
        if s and s["notes_status"] == "done":
            break
        time.sleep(0.02)
    # and the client can collect the result by polling the same id it used
    st = c.get(f"/api/sessions/{unknown}").json()
    assert st["notes_status"] == "done" and st["notes"].startswith("## 會議摘要")


def test_unknown_session_without_a_transcript_still_404s(tmp_path, monkeypatch):
    """Nothing to work from — say so rather than inventing an empty session."""
    _db(tmp_path, monkeypatch)
    c = TestClient(appmod.app)
    r = c.post("/api/sessions/nope/analyze", json={})
    assert r.status_code == 404 and r.json()["error"] == "查無此工作"


def test_ensure_session_is_idempotent(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    a = sessions.ensure_session("fixed-id", client_id="local-9")
    b = sessions.ensure_session("fixed-id", client_id="local-9")
    assert a["id"] == b["id"] == "fixed-id"


def test_background_analyze_reports_real_progress_while_generating(tmp_path, monkeypatch):
    """Notes generation is the slowest step and used to be a blind wait. Progress is derived from
    characters actually produced (not a timer), and never claims 100% before the result is stored."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)
    seen = []

    class StreamingProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            for chars in (100, 400, 5000):        # last one overshoots the estimate on purpose
                on_progress(chars)
                seen.append(sessions.get_session(sid)["notes_pct"])
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": StreamingProvider())

    c = TestClient(appmod.app)
    c.post(f"/api/sessions/{sid}/analyze", json={"background": True})
    for _ in range(100):
        if sessions.get_session(sid)["notes_status"] == "done":
            break
        time.sleep(0.02)

    assert seen == sorted(seen)                   # progress only moves forward
    assert max(seen) <= 0.95                      # never claims done while still generating
    st = c.get(f"/api/sessions/{sid}").json()
    assert st["notes_pct"] == 1.0 and st["notes_status"] == "done"


def test_notes_progress_is_visible_through_the_status_endpoint(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    sessions.update_session(sid, notes_status="running", notes_pct=0.42, notes_message="生成中…（已寫 300 字）")
    st = TestClient(appmod.app).get(f"/api/sessions/{sid}").json()
    assert st["notes_pct"] == 0.42 and "300 字" in st["notes_message"]


def test_notes_target_scales_with_transcript_length_within_bounds():
    assert appmod._notes_target_chars("x" * 100) == 500          # floor
    assert appmod._notes_target_chars("x" * 100000) == 2500      # ceiling
    assert appmod._notes_target_chars("x" * 10000) == 1500       # scaled


def test_a_queued_notes_job_is_reported_as_waiting_not_generating(tmp_path, monkeypatch):
    """A ThreadPoolExecutor queues silently, so a job waiting its turn used to look identical to one
    being generated — the user saw 生成中 with nothing happening. It must say it is waiting, and
    where in the line it is."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)

    # never let the worker start, so the job stays queued for the assertions
    monkeypatch.setattr(appmod._notes_executor, "submit", lambda *a, **k: None)

    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={"background": True})
    assert r.status_code == 200

    st = c.get(f"/api/sessions/{sid}").json()
    assert st["notes_status"] == "queued"          # NOT "running"
    assert st["notes_message"] == "排隊中…"
    assert st["notes_queue_position"] == 1         # first in line

    # a second submission lines up behind the first
    sid2 = sessions.create_session("m2.wav")
    _seed_transcript(sid2)
    c.post(f"/api/sessions/{sid2}/analyze", json={"background": True})
    assert c.get(f"/api/sessions/{sid2}").json()["notes_queue_position"] == 2
    # and the debug endpoint lists who is waiting
    assert appmod.notes_queue_position(sid) == 1
    assert c.get("/api/debug/jobs").json()["notes"]["waiting"] == [sid, sid2]


def test_a_job_that_starts_running_leaves_the_queue(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    _seed_transcript(sid)
    seen_status = {}

    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None, on_progress=None):
            # by the time we are generating, the job must no longer be queued
            seen_status["while_running"] = sessions.get_session(sid)["notes_status"]
            seen_status["position"] = appmod.notes_queue_position(sid)
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())

    c = TestClient(appmod.app)
    c.post(f"/api/sessions/{sid}/analyze", json={"background": True})
    for _ in range(100):
        if sessions.get_session(sid)["notes_status"] == "done":
            break
        time.sleep(0.02)

    assert seen_status["while_running"] == "running"
    assert seen_status["position"] == 0            # left the queue
    assert c.get("/api/debug/jobs").json()["notes"]["waiting"] == []


def test_recognition_progress_moves_instead_of_freezing(tmp_path, monkeypatch):
    """Breeze ASR reports nothing while it works, so the bar used to sit at one number for the whole
    (longest) phase — 61% every time, which reads as stuck. The estimate must advance, stay inside
    the phase, and never go backwards."""
    _db(tmp_path, monkeypatch)
    sid = sessions.create_session("m.wav")
    sessions.set_part(sid, 0, str(tmp_path / "p0.wav"))
    (tmp_path / "p0.wav").write_bytes(b"x")

    monkeypatch.setattr(appmod.media, "concat_to_wav", lambda parts, out: open(out, "wb").write(b"x"))
    monkeypatch.setattr(appmod.asr, "probe_duration", lambda p: 600.0)      # a 10-minute meeting
    seen = []

    def slow_asr(wav, **kw):
        for _ in range(3):                      # let the ticker run a few times
            time.sleep(2.2)
            seen.append(sessions.get_session(sid)["pct"])
        return {"segments": [], "speakers": []}
    monkeypatch.setattr(appmod.asr, "transcribe_diarize", slow_asr)
    monkeypatch.setattr(appmod.asr, "normalize", lambda d: {"segments": [], "speakers": [], "duration": 0})

    appmod._run_transcribe(sid)

    assert len(seen) >= 2
    assert seen == sorted(seen)                  # only ever moves forward
    assert seen[-1] > seen[0]                    # and it actually moved
    assert all(0.35 <= p < 0.95 for p in seen)   # stays inside the recognition phase
    assert sessions.get_session(sid)["pct"] == 1.0   # completion is what reaches 100%
