import os, json, time, pytest
from fastapi.testclient import TestClient
import app as appmod, asr, llm

pytestmark = pytest.mark.skipif(os.environ.get("HAOJI_INTEGRATION") != "1",
                                reason="set HAOJI_INTEGRATION=1 and provide SAMPLE_AUDIO")

def test_end_to_end_real_services():
    assert asr.detect_asr_base(), "Breeze ASR not reachable on :8765"
    assert llm.llm_status()[0], "Ollama not reachable on :11434"
    sample = os.environ["SAMPLE_AUDIO"]   # path to a short wav/m4a
    c = TestClient(appmod.app)
    with open(sample, "rb") as f:
        sid = c.post("/api/sessions", files={"file": (os.path.basename(sample), f, "audio/mp4")}).json()["session_id"]
    for _ in range(600):
        s = c.get(f"/api/sessions/{sid}").json()
        if s["status"] in ("done", "error"): break
        time.sleep(1)
    assert s["status"] == "done", s
    notes = c.post(f"/api/sessions/{sid}/analyze", json={}).json()["notes"]
    assert "##" in notes
