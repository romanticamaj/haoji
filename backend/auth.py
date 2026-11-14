# -*- coding: utf-8 -*-
"""Who may do what.

- **Admin token**: guards the control console and every endpoint that changes the server or reveals
  operational detail. From HAOJI_ADMIN_TOKEN, else generated once into DATA_DIR/admin_token (logged
  at startup so a self-hoster can find it with `docker compose logs`).
- **Pairing token**: what a phone presents. Shown to the admin as a QR code (haoji://pair?...).
  Enforced on /api/sessions* only when HAOJI_REQUIRE_TOKEN=1, so already-installed apps keep working
  until the operator opts in.
- **Origin guard**: a state-changing request that carries an Origin header must come from this very
  host. Blocks DNS-rebinding / cross-site requests from a browser; curl and the phone send no Origin.
"""
import hmac, os, secrets, threading
from urllib.parse import quote, urlparse
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
import config, errors

_lock = threading.Lock()
COOKIE = "haoji_admin"


def _token_file(name, env):
    v = (os.environ.get(env) or "").strip()
    if v:
        return v
    path = os.path.join(config.DATA_DIR, name)
    with _lock:
        try:
            with open(path, encoding="utf-8") as f:
                t = f.read().strip()
            if t:
                return t
        except FileNotFoundError:
            pass
        os.makedirs(config.DATA_DIR, exist_ok=True)
        t = secrets.token_urlsafe(24)
        with open(path, "w", encoding="utf-8") as f:
            f.write(t)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return t


def admin_token():
    return _token_file("admin_token", "HAOJI_ADMIN_TOKEN")


def admin_token_source():
    return "env" if (os.environ.get("HAOJI_ADMIN_TOKEN") or "").strip() else "file"


def pairing_token():
    return _token_file("pairing_token", "HAOJI_PAIRING_TOKEN")


def rotate_pairing():
    if (os.environ.get("HAOJI_PAIRING_TOKEN") or "").strip():
        return pairing_token()                      # env-pinned: rotating would be a lie
    path = os.path.join(config.DATA_DIR, "pairing_token")
    with _lock:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
    return pairing_token()


def pairing_required():
    return (os.environ.get("HAOJI_REQUIRE_TOKEN") or "").strip() in ("1", "true", "yes")


def _bearer(request: Request):
    h = request.headers.get("authorization") or ""
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def _eq(a, b):
    return bool(a) and bool(b) and hmac.compare_digest(a.encode(), b.encode())


def is_admin(request: Request):
    tok = admin_token()
    return _eq(_bearer(request), tok) or _eq(request.cookies.get(COOKIE, ""), tok)


def require_admin(request: Request):
    if not is_admin(request):
        raise errors.ApiError("unauthorized", "需要管理金鑰。",
                              "在主機上執行 `docker compose logs haoji-backend | grep admin` 找到金鑰。",
                              status=401)


def origin_ok(request: Request):
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return True
    origin = request.headers.get("origin")
    if not origin:
        return True
    return urlparse(origin).netloc.lower() == (request.headers.get("host") or "").lower()


def pairing_ok(request: Request):
    if not pairing_required():
        return True
    return _eq(_bearer(request), pairing_token())


def candidate_urls(request: Request | None = None):
    urls = []
    for u in (os.environ.get("HAOJI_PUBLIC_URLS") or "").split(","):
        u = u.strip().rstrip("/")
        if u and u not in urls:
            urls.append(u)
    if request is not None:
        here = str(request.base_url).rstrip("/")
        host = urlparse(here).hostname or ""
        if host not in ("localhost", "127.0.0.1", "testserver", "0.0.0.0") and here not in urls:
            urls.append(here)
    import asr                                   # local import: asr pulls in requests/subprocess
    for ip in asr._local_ips():
        if ip.startswith("127."):
            continue
        u = f"http://{ip}:{config.WEB_PORT}"
        if u not in urls:
            urls.append(u)
    return urls


router = APIRouter(prefix="/api")


@router.post("/console/login")
async def console_login(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    tok = (body.get("token") if isinstance(body, dict) else "") or ""
    if not _eq(tok.strip(), admin_token()):
        return errors.api_error("unauthorized", "管理金鑰不對。",
                                "金鑰在主機的 DATA_DIR/admin_token，或啟動日誌裡。", status=401)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(COOKIE, admin_token(), httponly=True, samesite="strict", max_age=30 * 86400)
    return resp


@router.post("/console/logout")
def console_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE)
    return resp


@router.get("/pairing", dependencies=[Depends(require_admin)])
def pairing(request: Request):
    tok = pairing_token()
    urls = candidate_urls(request)
    first = urls[0] if urls else str(request.base_url).rstrip("/")
    return {"token": tok, "urls": urls,
            "qr_payload": f"haoji://pair?url={quote(first, safe='')}&token={quote(tok, safe='')}"}


@router.post("/pairing/rotate", dependencies=[Depends(require_admin)])
def pairing_rotate():
    return {"token": rotate_pairing()}
