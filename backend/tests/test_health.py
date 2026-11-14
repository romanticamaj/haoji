from fastapi.testclient import TestClient
import app as appmod

client = TestClient(appmod.app)

def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "haoji-backend"
