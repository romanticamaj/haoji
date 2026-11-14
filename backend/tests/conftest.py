# -*- coding: utf-8 -*-
import os

# Starlette's TestClient sends `Host: testserver`. It is a name (not an IP), so the host allowlist in
# auth.py would refuse it like any unknown DNS name. Allow it for the whole test run.
os.environ.setdefault("HAOJI_ALLOWED_HOSTS", "testserver")
