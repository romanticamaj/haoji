# -*- coding: utf-8 -*-
from urllib.parse import parse_qs, urlparse
import pytest
from fastapi.testclient import TestClient
import app as appmod, auth, config, sessions


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "t.db"))
    for k in ("HAOJI_ADMIN_TOKEN", "HAOJI_PAIRING_TOKEN", "HAOJI_REQUIRE_TOKEN", "HAOJI_PUBLIC_URLS"):
        monkeypatch.delenv(k, raising=False)
    sessions.init_db()
    return TestClient(appmod.app)


def test_admin_token_persisted_and_stable(client, tmp_path):
    t1 = auth.admin_token()
    assert len(t1) >= 24
    assert (tmp_path / "admin_token").read_text().strip() == t1
    assert auth.admin_token() == t1


def test_env_admin_token_wins(client, monkeypatch):
    monkeypatch.setenv("HAOJI_ADMIN_TOKEN", "from-env")
    assert auth.admin_token() == "from-env"


def test_require_admin_401_without_token(client):
    r = client.get("/api/pairing")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
    r = client.get("/api/pairing", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_require_admin_ok_with_bearer_and_cookie(client):
    tok = auth.admin_token()
    assert client.get("/api/pairing", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    r = client.post("/api/console/login", json={"token": f"  {tok}\n"})
    assert r.status_code == 200
    assert "haoji_admin" in r.cookies or "haoji_admin" in client.cookies
    assert client.get("/api/pairing").status_code == 200


def test_login_wrong_token(client):
    r = client.post("/api/console/login", json={"token": "nope"})
    assert r.status_code == 401


def test_cross_origin_post_rejected(client):
    tok = auth.admin_token()
    r = client.post("/api/pairing/rotate", headers={
        "Authorization": f"Bearer {tok}", "Origin": "http://evil.example"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_origin"


def test_same_origin_post_allowed(client):
    tok = auth.admin_token()
    r = client.post("/api/pairing/rotate", headers={
        "Authorization": f"Bearer {tok}", "Origin": "http://testserver"})
    assert r.status_code == 200


def test_no_origin_header_allowed(client):
    tok = auth.admin_token()
    assert client.post("/api/pairing/rotate",
                       headers={"Authorization": f"Bearer {tok}"}).status_code == 200


def test_pairing_payload_shape(client, monkeypatch):
    monkeypatch.setenv("HAOJI_PUBLIC_URLS", "http://100.64.0.5:7780/, https://haoji.tail.ts.net")
    tok = auth.admin_token()
    j = client.get("/api/pairing", headers={"Authorization": f"Bearer {tok}"}).json()
    assert j["urls"][:2] == ["http://100.64.0.5:7780", "https://haoji.tail.ts.net"]
    assert j["qr_payload"].startswith("haoji://pair?url=http")
    q = parse_qs(urlparse(j["qr_payload"]).query)
    assert q["url"] == ["http://100.64.0.5:7780"]
    assert q["token"] == [j["token"]]
    assert all("127.0.0.1" not in u for u in j["urls"])


def test_rotate_changes_token(client):
    tok = auth.admin_token()
    h = {"Authorization": f"Bearer {tok}"}
    before = client.get("/api/pairing", headers=h).json()["token"]
    after = client.post("/api/pairing/rotate", headers=h).json()["token"]
    assert before != after
    assert client.get("/api/pairing", headers=h).json()["token"] == after


def test_sessions_open_by_default_and_guarded_when_required(client, monkeypatch):
    assert client.post("/api/sessions", json={}).status_code == 200
    monkeypatch.setenv("HAOJI_REQUIRE_TOKEN", "1")
    r = client.post("/api/sessions", json={})
    assert r.status_code == 401
    ok = client.post("/api/sessions", json={},
                     headers={"Authorization": f"Bearer {auth.pairing_token()}"})
    assert ok.status_code == 200
    # the admin token is not a pairing token
    assert client.post("/api/sessions", json={},
                       headers={"Authorization": f"Bearer {auth.admin_token()}"}).status_code == 401


# --- DNS rebinding: the Host header must be an IP, localhost, or an allowlisted name ------------

@pytest.mark.parametrize("host", ["127.0.0.1:7780", "localhost:7780", "192.168.1.20:7780",
                                  "100.64.0.5", "[::1]:7780", "testserver"])
def test_ip_and_allowed_hosts_pass(client, host):
    assert client.get("/health", headers={"Host": host}).status_code == 200


def test_unknown_dns_name_rejected(client):
    r = client.get("/api/status", headers={"Host": "evil.example:7780"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_host"
    assert "HAOJI_ALLOWED_HOSTS" in r.json()["error"]["hint"]


def test_rebinding_post_with_matching_origin_and_host_rejected(client):
    # The attack: evil.example rebinds to this box, so Origin and Host agree with each other.
    tok = auth.admin_token()
    r = client.post("/api/pairing/rotate", headers={
        "Authorization": f"Bearer {tok}", "Host": "evil.example:7780", "Origin": "http://evil.example:7780"})
    assert r.status_code == 403


def test_public_url_names_allowed(client, monkeypatch):
    monkeypatch.setenv("HAOJI_PUBLIC_URLS", "https://haoji.tail1234.ts.net")
    assert client.get("/health", headers={"Host": "haoji.tail1234.ts.net"}).status_code == 200


def test_cross_origin_post_from_ip_origin_rejected(client):
    # Origin must also be allowed and match the Host — another site on the LAN can't drive the console.
    tok = auth.admin_token()
    r = client.post("/api/pairing/rotate", headers={
        "Authorization": f"Bearer {tok}", "Host": "192.168.1.20:7780", "Origin": "http://192.168.1.99:8080"})
    assert r.status_code == 403


def test_admin_token_never_logged(client, caplog):
    import logging
    caplog.set_level(logging.INFO)
    with TestClient(appmod.app):
        pass
    tok = auth.admin_token()
    assert tok not in caplog.text
    assert "admin_token" in caplog.text
