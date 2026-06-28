import llm

def test_to_traditional_converts_simplified():
    assert llm.to_traditional("我们进行测试") == "我們進行測試"

def test_num_ctx_sizing_floor_and_step(monkeypatch):
    sizes = {}
    def fake_post(url, json, timeout):
        sizes["num_ctx"] = json["options"]["num_ctx"]
        class R:
            def raise_for_status(self): pass
            def json(self): return {"message": {"content": "## 會議摘要\n好"}}
        return R()
    monkeypatch.setattr(llm, "llm_status", lambda: (True, ["gemma4:e4b-it-qat"], []))
    monkeypatch.setattr(llm.requests, "post", fake_post)
    p = llm.OllamaProvider()
    out = p.generate_meeting_notes("短逐字稿", model="gemma4:e4b-it-qat")
    assert sizes["num_ctx"] == 8192        # floor
    assert out.startswith("## 會議摘要")

def test_strips_thinking_block(monkeypatch):
    def fake_post(url, json, timeout):
        class R:
            def raise_for_status(self): pass
            def json(self): return {"message": {"content": "推理...</think>## 會議摘要\n內容"}}
        return R()
    monkeypatch.setattr(llm, "llm_status", lambda: (True, ["m"], ["m"]))
    monkeypatch.setattr(llm.requests, "post", fake_post)
    out = llm.OllamaProvider().generate_meeting_notes("x", model="m")
    assert "</think>" not in out and out.startswith("## 會議摘要")
