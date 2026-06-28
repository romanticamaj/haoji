# 好記 Haoji — Backend

FastAPI service: upload audio → diarized transcript → Markdown meeting notes.

## Run
    pip install -r requirements.txt
    python app.py        # serves on http://0.0.0.0:8780

Requires Breeze ASR on :8765 and Ollama on :11434 (dev machine).

## Endpoints
- `GET  /health`
- `POST /api/sessions`            (multipart file) -> {session_id}
- `GET  /api/sessions/{id}`       -> status + transcript
- `POST /api/sessions/{id}/analyze` {model?, names?} -> {notes}
- `GET  /api/llm/models`
