# Security policy

Haoji is self-hosted: the server you run sees the audio while it transcribes it. Please report
anything that could expose a recording, transcript, or the server itself.

**Report privately** via GitHub → *Security* → *Report a vulnerability* (private advisory).
Please do not open a public issue. We aim to reply within 7 days.

## What the server protects today

| Surface | Protection |
|---|---|
| Control console and admin API (`/console`, `/api/settings`, `/api/llm/*`, `/api/jobs`, `/api/pairing`, `/api/status?detail=1`) | Admin token (Bearer or an httpOnly SameSite=Strict cookie) |
| Phone API (`/api/sessions*`) | Pairing token when `HAOJI_REQUIRE_TOKEN=1` (recommended once your phones are paired) |
| DNS rebinding | Host must be an IP, `localhost`, or a name in `HAOJI_ALLOWED_HOSTS` / `HAOJI_PUBLIC_URLS`; cross-origin browser writes are refused |
| CORS | Off unless `HAOJI_CORS_ORIGINS` lists origins |
| Data retention | Audio parts are deleted when transcription ends; transcript/notes are blanked after `HAOJI_RETENTION_HOURS` (default 24, `0` = once the phone has collected them) |

The server speaks plain HTTP. Do not port-forward it to the internet. Reach it over your LAN, a VPN,
or Tailscale (`tailscale serve` gives you HTTPS).
