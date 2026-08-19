"""Background-job behaviour: the server must be able to finish the work with the client gone.

Two things make that possible:
  * expected_parts → the server starts transcription itself once every part has landed, so an upload
    completed by the OS (background URLSession, app closed) still gets processed.
  * background analyze → notes generation is queued and the result stored, so a client that is
    backgrounded or killed mid-generation collects it later instead of paying for a second LLM run.
"""
import json, time
from fastapi.testclient import TestClient
import app as appmod, sessions


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
        def generate_meeting_notes(self, transcript, model=None):
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
        def generate_meeting_notes(self, transcript, model=None):
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
        def generate_meeting_notes(self, transcript, model=None):
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
        def generate_meeting_notes(self, transcript, model=None):
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
        def generate_meeting_notes(self, transcript, model=None):
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
