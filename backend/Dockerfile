# Build context: the REPO ROOT (see deploy/docker-compose.yml) so the console can read app/lib/theme.ts.
#   docker build -f backend/Dockerfile -t haoji-backend .

# --- 1. control console (static SPA) -------------------------------------------------------------
FROM node:22-slim AS console
WORKDIR /src
COPY app/lib/theme.ts app/lib/theme.ts
COPY backend/tests/fixtures/contracts backend/tests/fixtures/contracts
COPY backend/console/package.json backend/console/package-lock.json backend/console/
RUN cd backend/console && npm ci --no-audit --no-fund
COPY backend/console backend/console
RUN cd backend/console && npm run build

# --- 2. API server -------------------------------------------------------------------------------
FROM python:3.11-slim

# ffmpeg/ffprobe on PATH (config._find picks them up); curl for the healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/*.py ./
COPY --from=console /src/backend/console/dist /app/console/dist

ENV DATA_DIR=/data \
    HAOJI_CONSOLE_DIR=/app/console/dist \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 7780
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:7780/health || exit 1

CMD ["python", "app.py"]
