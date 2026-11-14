# -*- coding: utf-8 -*-
"""Apple Push Notification service (APNs) sender.

Transcription runs here, on the server, long after the phone has locked or suspended the app — so the
app itself can never be the one to say "your transcript is ready". The phone hands over its device
token when it creates the session; when the job ends we send ONE push and forget the token.

Token-based (.p8) auth: a JWT signed with the team's APNs key, cached and refreshed well inside Apple's
one-hour limit. Everything is optional — with no key configured `send()` is a logged no-op, so a
deployment without push keeps working exactly as before.
"""
import logging, threading, time

import config

log = logging.getLogger(__name__)

_HOSTS = {
    "production": "https://api.push.apple.com",
    "sandbox": "https://api.sandbox.push.apple.com",
}

_jwt_lock = threading.Lock()
_jwt = {"token": None, "at": 0.0}
_JWT_TTL = 45 * 60          # Apple rejects tokens older than an hour and throttles refreshing <20 min


def enabled():
    return bool(config.APNS_KEY_PATH and config.APNS_KEY_ID and config.APNS_TEAM_ID)


def _provider_token():
    import jwt   # PyJWT (+ cryptography for ES256); imported lazily so push stays optional
    with _jwt_lock:
        now = time.time()
        if _jwt["token"] and now - _jwt["at"] < _JWT_TTL:
            return _jwt["token"]
        with open(config.APNS_KEY_PATH) as f:
            key = f.read()
        tok = jwt.encode({"iss": config.APNS_TEAM_ID, "iat": int(now)}, key,
                         algorithm="ES256", headers={"kid": config.APNS_KEY_ID})
        _jwt.update(token=tok, at=now)
        return tok


def send(token, env, title, body, data=None):
    """Send one alert push. Returns True if APNs accepted it. Never raises — a push is a courtesy,
    and failing to send one must not fail the job that triggered it."""
    if not token:
        return False
    if not enabled():
        log.info("push skipped: APNs not configured")
        return False
    host = _HOSTS.get(env or "production", _HOSTS["production"])
    payload = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    if data:
        payload.update(data)
    try:
        import httpx
        with httpx.Client(http2=True, timeout=10) as c:
            r = c.post(f"{host}/3/device/{token}", json=payload, headers={
                "authorization": f"bearer {_provider_token()}",
                "apns-topic": config.APNS_TOPIC,
                "apns-push-type": "alert",
                "apns-priority": "10",
            })
        if r.status_code == 200:
            return True
        log.warning("push rejected (%s): %s", r.status_code, r.text[:200])
    except Exception as e:
        log.warning("push failed: %s", e)
    return False
