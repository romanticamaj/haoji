#!/bin/sh
# Start ollama, then make sure the configured model is present (first boot pulls
# it into the models volume; later boots are no-ops).
set -e
ollama serve &
SERVE_PID=$!
sleep 3
if ! ollama list | grep -q "${LLM_MODEL}"; then
  echo "[ollama-init] pulling ${LLM_MODEL}..."
  ollama pull "${LLM_MODEL}"
fi
wait $SERVE_PID
