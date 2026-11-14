# -*- coding: utf-8 -*-
import importlib
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def app_with_console(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>好記 主機控制台</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setenv("HAOJI_CONSOLE_DIR", str(dist))
    import config, app as appmod
    importlib.reload(config); importlib.reload(appmod)
    yield appmod
    monkeypatch.delenv("HAOJI_CONSOLE_DIR")
    importlib.reload(config); importlib.reload(appmod)


def test_console_served_when_dist_exists(app_with_console):
    c = TestClient(app_with_console.app)
    r = c.get("/console/")
    assert r.status_code == 200 and "主機控制台" in r.text
    assert c.get("/console/assets/app.js").status_code == 200


def test_root_redirects_to_console(app_with_console):
    r = TestClient(app_with_console.app).get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/console/"


def test_api_unaffected(app_with_console):
    assert TestClient(app_with_console.app).get("/health").json()["service"] == "haoji-backend"


def test_no_console_no_mount(monkeypatch, tmp_path):
    monkeypatch.setenv("HAOJI_CONSOLE_DIR", str(tmp_path / "missing"))
    import config, app as appmod
    importlib.reload(config); importlib.reload(appmod)
    try:
        assert TestClient(appmod.app).get("/console/").status_code == 404
    finally:
        monkeypatch.delenv("HAOJI_CONSOLE_DIR")
        importlib.reload(config); importlib.reload(appmod)
