# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi import FastAPI
import config

app = FastAPI(title="好記 Haoji API")

@app.get("/health")
def health():
    return {"status": "ok", "service": "haoji-backend"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.WEB_HOST, port=config.WEB_PORT, log_level="warning")
