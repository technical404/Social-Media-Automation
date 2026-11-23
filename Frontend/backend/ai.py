"""Provider adapters (OpenAI-compatible, Anthropic, Gemini, Ollama). Keys are never logged or returned."""
import json
import re
import time
import urllib.error
import urllib.request


class ProviderError(Exception):
    def __init__(self, kind: str, message: str, status: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.status = status


def redact(s: str, secret: str | None) -> str:
    if secret and len(secret) > 4:
        s = s.replace(secret, "••••")
    s = re.sub(r"(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+", r"\1••••", s)
    return re.sub(r"(key=)[^&\s\"]+", r"\1••••", s, flags=re.I)


def _post(url: str, headers: dict, body: dict, timeout_s: float, secret: str | None) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        text = redact(e.read().decode("utf-8", "replace")[:400], secret)
        raise _http_error(e.code, text)
    except TimeoutError:
        raise ProviderError("timeout", f"No response within {int(timeout_s)}s.")
    except urllib.error.URLError as e:
        raise ProviderError("network", f"Could not reach the provider: {redact(str(e.reason), secret)}")
    except json.JSONDecodeError:
        raise ProviderError("bad_response", "Provider returned a response that is not JSON.")


def _http_error(code: int, text: str) -> ProviderError:
    low = text.lower()
    if code in (401, 403) or "invalid api key" in low or "unauthenticated" in low or "expired" in low:
        if "expired" in low:
            return ProviderError("auth", f"API key expired (HTTP {code}). {text}".strip(), code)
        return ProviderError("auth", f"Invalid or unauthorized API key (HTTP {code}). {text}".strip(), code)
    if code == 402 or "insufficient" in low or "credit" in low or "quota" in low or "billing" in low:
        return ProviderError("credits", f"Credits, quota or billing exhausted (HTTP {code}). {text}".strip(), code)
    if code == 429:
        if "credit" in low or "quota" in low:
            return ProviderError("credits", f"Credits or quota exhausted (HTTP 429). {text}".strip(), 429)
        return ProviderError("rate_limit", f"Rate limit reached (HTTP 429). {text}".strip(), 429)
    if code == 404:
        return ProviderError("model", f"Model or endpoint not found (HTTP 404). {text}".strip(), 404)
    if code == 410:
        return ProviderError("model", f"This model is no longer available (HTTP 410). {text}".strip(), 410)
    return ProviderError("bad_response", f"Provider returned HTTP {code}: {text}", code)


def _get(url: str, headers: dict, timeout_s: float, secret: str | None) -> dict:
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        text = redact(e.read().decode("utf-8", "replace")[:400], secret)
        raise _http_error(e.code, text)
    except TimeoutError:
        raise ProviderError("timeout", f"No response within {int(timeout_s)}s.")
    except urllib.error.URLError as e:
        raise ProviderError("network", f"Could not reach the provider: {redact(str(e.reason), secret)}")
    except json.JSONDecodeError:
        raise ProviderError("bad_response", "Provider returned a response that is not JSON.")


def list_models(p: dict, api_key: str | None) -> list[dict]:
    """Fetch model IDs from the provider. Never logs the key."""
    base = (p.get("base_url") or "").rstrip("/")
    proto = p["protocol"]
    timeout_s = max(10, min(60, int(p.get("timeout_ms") or 90000) / 1000))
    if proto == "mock":
        return [{"id": "deterministic-test", "name": "deterministic-test"}]
    if proto == "gemini":
        if not api_key:
            raise ProviderError("config", "This provider has no API key saved yet.")
        data = _get(f"{base}/v1beta/models", {"x-goog-api-key": api_key}, timeout_s, api_key)
        out = []
        for m in data.get("models") or []:
            mid = str(m.get("name") or "").split("/")[-1]
            if mid:
                out.append({"id": mid, "name": mid})
        return out
    if proto == "anthropic":
        if not api_key:
            raise ProviderError("config", "This provider has no API key saved yet.")
        data = _get(f"{base}/v1/models", {"x-api-key": api_key, "anthropic-version": "2023-06-01"}, timeout_s, api_key)
        return [{"id": str(m.get("id")), "name": str(m.get("display_name") or m.get("id"))} for m in (data.get("data") or []) if m.get("id")]
    if proto in ("openai", "ollama", "nvidia", "perplexity", "custom", "groq"):
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        data = _get(f"{base}/models", headers, timeout_s, api_key)
        return [{"id": str(m.get("id")), "name": str(m.get("id"))} for m in (data.get("data") or []) if m.get("id")]
    raise ProviderError("config", f"Protocol '{proto}' does not support model listing.")


def run_text(p: dict, api_key: str | None, system: str, user: str, want_json: bool) -> dict:
    started = time.time()
    base = (p.get("base_url") or "").rstrip("/")
    proto = p["protocol"]
    timeout_s = max(1, int(p.get("timeout_ms") or 90000) / 1000)
    if proto != "ollama" and not api_key:
        raise ProviderError("config", "This provider has no API key saved yet.")
    u = f"{user}\n\nReturn JSON only." if want_json else user
    finish_reason = None
    if proto in ("openai", "ollama", "nvidia", "perplexity", "custom"):
        body = {"model": p["model_id"], "messages": [{"role": "system", "content": system}, {"role": "user", "content": u}], "max_tokens": int(p.get("max_output") or 4096)}
        if want_json:
            body["response_format"] = {"type": "json_object"}
        if p.get("thinking_effort") not in (None, "none"):
            body["reasoning_effort"] = p["thinking_effort"]
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        data = _post(f"{base}/chat/completions", headers, body, timeout_s, api_key)
        choice = (data.get("choices") or [{}])[0] or {}
        text = (choice.get("message") or {}).get("content") or ""
        finish_reason = choice.get("finish_reason")
    elif proto == "anthropic":
        data = _post(f"{base}/v1/messages", {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                     {"model": p["model_id"], "max_tokens": int(p.get("max_output") or 4096), "system": system, "messages": [{"role": "user", "content": u}]},
                     timeout_s, api_key)
        text = "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
        finish_reason = data.get("stop_reason")
    elif proto == "gemini":
        gen = {"maxOutputTokens": int(p.get("max_output") or 4096)}
        if want_json:
            gen["responseMimeType"] = "application/json"
        data = _post(f"{base}/v1beta/models/{p['model_id']}:generateContent", {"x-goog-api-key": api_key},
                     {"systemInstruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": gen},
                     timeout_s, api_key)
        candidate = (data.get("candidates") or [{}])[0] or {}
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(x.get("text", "") for x in parts)
        finish_reason = candidate.get("finishReason")
    else:
        raise ProviderError("config", f"Protocol '{proto}' is not supported by the local backend.")
    if not text:
        raise ProviderError("bad_response", "The provider returned an empty answer.")
    return {"text": text, "ms": int((time.time() - started) * 1000), "model": p["model_id"], "finish_reason": finish_reason}
