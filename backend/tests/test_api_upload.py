import io, json, time
from fastapi import UploadFile
from fastapi.testclient import TestClient
import app as appmod, sessions

def test_upload_rejects_bad_ext(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("x.txt", b"nope", "text/plain")})
    assert r.status_code == 400

def test_upload_accepts_and_runs_job(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    sessions.init_db()
    # stub the heavy pipeline so the worker runs instantly
    monkeypatch.setattr(appmod, "_run_transcribe", lambda sid, path: sessions.update_session(
        sid, status="done", pct=1.0, transcript=json.dumps({"segments": [], "speakers": []})))
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("m.m4a", b"\x00\x01\x02", "audio/mp4")})
    assert r.status_code == 200
    sid = r.json()["session_id"]
    for _ in range(50):
        if sessions.get_session(sid)["status"] == "done":
            break
        time.sleep(0.02)
    assert sessions.get_session(sid)["status"] == "done"

def test_upload_write_failure_cleans_up(tmp_path, monkeypatch):
    """If the write loop raises (e.g. disk full), the partial dest file must be
    deleted and the endpoint must return 500 — no orphaned media left behind."""
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    sessions.init_db()

    # Patch builtins.open so that writing to the upload .m4a file raises OSError
    # but still physically creates the empty dest file (simulating a disk-full after
    # the OS creates the inode).  All other open() calls are passed through.
    import builtins
    real_open = builtins.open

    def _failing_open(path, mode="r", *args, **kwargs):
        if "wb" in str(mode) and str(path).startswith(str(tmp_path)) and str(path).endswith(".m4a"):
            # Create the empty file on disk so dest exists, then return a stub
            # whose write() raises — mimicking a mid-write disk-full error.
            real_open(path, mode, *args, **kwargs).close()

            class _FailWrite:
                def __enter__(self): return self
                def __exit__(self, *a): return False   # do not suppress exception
                def write(self, data): raise OSError("disk full")
            return _FailWrite()
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _failing_open)

    # raise_server_exceptions=False: our fix returns a proper 500 JSONResponse,
    # but we set this to avoid the client re-raising any uncaught server error.
    c = TestClient(appmod.app, raise_server_exceptions=False)
    r = c.post("/api/sessions", files={"file": ("m.m4a", b"\x00\x01\x02", "audio/mp4")})

    assert r.status_code == 500, f"expected 500, got {r.status_code}"
    leftover = list(tmp_path.glob("*.m4a"))
    assert leftover == [], f"orphaned file(s) left on disk: {leftover}"
