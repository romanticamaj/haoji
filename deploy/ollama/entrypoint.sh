#!/bin/sh
# Start ollama, wait until it actually answers, then make sure the configured
# model is present (first boot pulls it into the models volume; later boots are
# no-ops). SIGTERM is forwarded so `docker stop` shuts ollama down cleanly.
ollama serve &
SERVE_PID=$!
trap 'kill -TERM $SERVE_PID 2>/dev/null; wait $SERVE_PID' TERM INT

# poll readiness instead of a blind sleep (slow disks need >3s)
i=0
until ollama list >/dev/null 2>&1; do
  i=$((i+1))
  if [ $i -ge 60 ]; then echo "[ollama-init] server not ready after 120s, continuing anyway"; break; fi
  sleep 2
done

if ! ollama list 2>/dev/null | grep -q "${LLM_MODEL}"; then
  echo "[ollama-init] pulling ${LLM_MODEL}..."
  ollama pull "${LLM_MODEL}" || echo "[ollama-init] pull failed (will retry on next boot; /api/tags stays empty until then)"
fi
wait $SERVE_PID
