# -*- coding: utf-8 -*-
"""One error shape for every control-plane endpoint: {"error": {code, message, hint}}.

The code is from a fixed list so the console and the app can branch on it; message is human
(Traditional Chinese), hint says what to do next. Older /api/sessions* endpoints keep their shapes."""
from fastapi.responses import JSONResponse

CODES = {
    "unauthorized", "forbidden_origin", "forbidden_host", "invalid_setting", "setting_locked",
    "ollama_unreachable", "model_in_use", "not_found", "bad_request",
}


class ApiError(Exception):
    def __init__(self, code, message, hint="", status=400):
        assert code in CODES, code
        super().__init__(message)
        self.code, self.message, self.hint, self.status = code, message, hint, status


def body(code, message, hint=""):
    return {"error": {"code": code, "message": message, "hint": hint}}


def api_error(code, message, hint="", status=400):
    assert code in CODES, code
    return JSONResponse(body(code, message, hint), status_code=status)
