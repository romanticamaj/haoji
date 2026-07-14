# -*- coding: utf-8 -*-
"""LLM provider abstraction + Ollama provider for Traditional-Chinese meeting notes."""
import re
import requests
import config
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

用 Markdown 輸出,章節:會議目的 / 與會者 / 會議摘要 / 討論重點(分主題) / 決策 / 待辦事項(依負責人) / 後續安排 / 一句話結論。某節若逐字稿真的沒提到,寫「(無)」。直接輸出會議記錄,不要開場白或客套話。"""

def llm_status():
    try:
        r = requests.get(config.OLLAMA_BASE + "/api/tags", timeout=3)
        r.raise_for_status()
        models = r.json().get("models", [])
        names = [m["name"] for m in models]
        thinking = [m["name"] for m in models if "thinking" in (m.get("capabilities") or [])]
        return True, names, thinking
    except Exception:
        return False, [], []

class OllamaProvider:
    name = "ollama"

    def generate_meeting_notes(self, transcript, model=None):
        model = model or config.LLM_MODEL
        ok, names, thinking = llm_status()
        if not ok:
            raise RuntimeError(f"連不到本機 LLM（Ollama，{config.OLLAMA_BASE}）。")
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
            "stream": False,
            "options": {"temperature": 0.3, "num_ctx": num_ctx},
        }
        if model in thinking and not config.LLM_THINK:
            payload["think"] = False
        try:
            r = requests.post(config.OLLAMA_BASE + "/api/chat", json=payload, timeout=config.LLM_TIMEOUT)
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"本機 LLM 請求失敗：{e}")
        content = (r.json().get("message", {}) or {}).get("content", "")
        if "</think>" in content:
            content = content.rsplit("</think>", 1)[-1]
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        return to_traditional(content)

_PROVIDERS = {"ollama": OllamaProvider()}
def get_provider(name="ollama"):
    return _PROVIDERS.get(name) or _PROVIDERS["ollama"]
