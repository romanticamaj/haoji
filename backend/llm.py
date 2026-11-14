# -*- coding: utf-8 -*-
"""LLM provider abstraction + Ollama provider for Traditional-Chinese meeting notes."""
import json
import re
import time
import requests
import config, settings
# Shared s2tw converter (also used by asr.normalize so the transcript is Traditional too). Imported
# into this namespace so existing references (llm.to_traditional) keep working.
from zhtw import to_traditional

MEETING_NOTES_PROMPT = """你是專業的會議記錄助理。下面是一份多人對話的逐字稿(格式「[時間] 講者: 內容」)。請整理成一份**詳盡、結構完整**的繁體中文會議記錄。

寫作要求:
- 忠實根據逐字稿,不要捏造。
- **講者一律照逐字稿標示的名字或代號(例如 SPEAKER_00)原樣使用。絕對不要自己猜測某個代號對應到對話中提到的哪個人名,也不要把某位講者的發言挪到另一位講者身上。**
- 角色或負責的項目,只有在「該講者自己說出口的內容」明確透露時才標註;不要憑空編造誰是客戶、誰是開發方。
- 內容要有細節、有資訊量。討論重點分主題逐項展開,把「為什麼這樣決定」「考慮過哪些方案/取捨」也寫進去。
- 條列盡量具體(數字、時間、服務名稱、指標都要保留)。

格式要求(務必遵守):
- 只用純文字與標準 Markdown。**絕對不要使用 LaTeX 或數學語法**——不要出現 `$...$`、`\\(...\\)`、`\\rightarrow`、`\\to` 這類東西。流程、箭頭一律直接用文字符號「→」。
- 每個章節用 `## 章節名` 當標題,標題自成一行,標題前後各空一行。條列用 `- `。
- **第一行必須是這場會議的主題,格式 `# 主題`**,例如 `# 電池模組供應商選擇`。用 6~16 個字概括這場會議在談什麼,要具體(講清楚是哪件事、哪個專案或哪個決策),不要寫「會議記錄」「會議紀要」這種通用詞,也不要加日期或編號。主題行之後空一行再開始第一個章節。

章節:會議目的 / 與會者 / 會議摘要 / 討論重點(分主題) / 決策 / 待辦事項(依負責人) / 後續安排 / 一句話結論。某節若逐字稿真的沒提到,寫「(無)」。直接輸出會議記錄,不要開場白或客套話。"""

def llm_status():
    try:
        r = requests.get(settings.ollama_base() + "/api/tags", timeout=3)
        r.raise_for_status()
        models = r.json().get("models", [])
        names = [m["name"] for m in models]
        thinking = [m["name"] for m in models if "thinking" in (m.get("capabilities") or [])]
        return True, names, thinking
    except Exception:
        return False, [], []

class OllamaProvider:
    name = "ollama"

    def generate_meeting_notes(self, transcript, model=None, on_progress=None):
        model = model or settings.llm_model()
        ok, names, thinking = llm_status()
        if not ok:
            raise RuntimeError(f"連不到本機 LLM（Ollama，{settings.ollama_base()}）。")
        if names and model not in names:
            raise RuntimeError(f"本機沒有模型「{model}」。可用：{', '.join(names) or '（無）'}")
        approx_prompt = int((len(MEETING_NOTES_PROMPT) + len(transcript)) * 0.8) + 16
        need = approx_prompt + config.LLM_OUTPUT_TOKENS
        num_ctx = max(8192, min(config.LLM_NUM_CTX_MAX, ((need + 8191) // 8192) * 8192))
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": MEETING_NOTES_PROMPT},
                {"role": "user", "content": transcript},
            ],
            # Stream only when someone wants progress: the non-streaming path stays the default so
            # nothing else changes shape.
            "stream": bool(on_progress),
            "options": {"temperature": 0.3, "num_ctx": num_ctx},
        }
        if model in thinking and not config.LLM_THINK:
            payload["think"] = False
        if on_progress:
            content = self._generate_streaming(payload, on_progress)
        else:
            try:
                r = requests.post(settings.ollama_base() + "/api/chat", json=payload, timeout=config.LLM_TIMEOUT)
                r.raise_for_status()
            except requests.exceptions.RequestException as e:
                raise RuntimeError(f"本機 LLM 請求失敗：{e}")
            content = (r.json().get("message", {}) or {}).get("content", "")
        if "</think>" in content:
            content = content.rsplit("</think>", 1)[-1]
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        return to_traditional(content)

    def _generate_streaming(self, payload, on_progress):
        """Read Ollama's NDJSON stream, reporting characters produced so far.

        Generation is the slowest step in the app and used to be a completely blind wait. The
        character count is REAL progress (not a timer), which is what makes a progress bar honest.
        Reports are throttled — this is for a human watching a list, not a firehose."""
        try:
            r = requests.post(settings.ollama_base() + "/api/chat", json=payload,
                              timeout=config.LLM_TIMEOUT, stream=True)
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"本機 LLM 請求失敗：{e}")

        parts, last_report = [], 0.0
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue                      # a keep-alive or partial line: skip, never crash
            chunk = (obj.get("message") or {}).get("content") or ""
            if chunk:
                parts.append(chunk)
                now = time.time()
                if now - last_report >= 0.7:
                    last_report = now
                    try:
                        on_progress(sum(len(p) for p in parts))
                    except Exception:
                        pass                  # a bad progress callback must never fail generation
            if obj.get("done"):
                break
        return "".join(parts)


def _clean(content):
    if "</think>" in content:
        content = content.rsplit("</think>", 1)[-1]
    return to_traditional(re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip())


class OpenAICompatProvider:
    """Any OpenAI-compatible /v1/chat/completions endpoint (DeepInfra, OpenRouter, vLLM, LM Studio,
    Ollama's own /v1). The "cloud API" deployment profile in docs/system-design-note.md: drop the
    ollama container and roughly halve the GPU requirement. Same prompt, same cleanup."""
    name = "openai"

    def generate_meeting_notes(self, transcript, model=None, on_progress=None):
        base = (settings.get("openai_base_url") or "").rstrip("/")
        if not base:
            raise RuntimeError("還沒設定 OpenAI 相容 API 的網址（OPENAI_BASE_URL）。")
        url = base + ("/chat/completions" if base.endswith("/v1") or "/v1/" in base + "/" else "/v1/chat/completions")
        headers = {"Content-Type": "application/json"}
        key = settings.get("openai_api_key")
        if key:
            headers["Authorization"] = f"Bearer {key}"
        payload = {"model": model or settings.llm_model(), "temperature": 0.3,
                   "max_tokens": config.LLM_OUTPUT_TOKENS,
                   "messages": [{"role": "system", "content": MEETING_NOTES_PROMPT},
                                {"role": "user", "content": transcript}]}
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=config.LLM_TIMEOUT)
            r.raise_for_status()
            content = ((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"會議記錄 API 請求失敗：{e}")
        if on_progress:
            try:
                on_progress(len(content))
            except Exception:
                pass
        return _clean(content)


_PROVIDERS = {"ollama": OllamaProvider(), "openai": OpenAICompatProvider()}
def get_provider(name="ollama"):
    return _PROVIDERS.get(name) or _PROVIDERS["ollama"]


def active_provider():
    """The provider the operator selected in settings (LLM_PROVIDER env or the console)."""
    return get_provider(settings.get("llm_provider"))
