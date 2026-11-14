# -*- coding: utf-8 -*-
"""Shared Simplified→Traditional (Taiwan) conversion via OpenCC (s2tw).

好記 is a Traditional-Chinese app, so EVERY Chinese string it shows the user must be Traditional.
Both the AI meeting notes (llm.py) and the diarized transcript (asr.normalize) run their text through
here. Falls back to the input unchanged if OpenCC isn't installed, so importing this never breaks a
box without the dependency (the GPU box has it).
"""
_opencc = None


def to_traditional(text):
    if not text:
        return text
    global _opencc
    try:
        if _opencc is None:
            import opencc
            _opencc = opencc.OpenCC("s2tw")
        return _opencc.convert(text)
    except Exception:
        return text
