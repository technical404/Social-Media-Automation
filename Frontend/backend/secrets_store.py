"""API key storage outside the database. On Windows keys are encrypted with DPAPI (tied to your Windows account)."""
import base64
import json
import os
import sys
import threading

from . import config

_lock = threading.Lock()


def _dpapi(data: bytes, encrypt: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = BLOB(len(data), buf)
    blob_out = BLOB()
    fn = ctypes.windll.crypt32.CryptProtectData if encrypt else ctypes.windll.crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(blob_in), None, None, None, None, 0x01, ctypes.byref(blob_out))
    if not ok:
        raise OSError("Windows could not protect/unprotect the key.")
    out = ctypes.string_at(blob_out.pbData, blob_out.cbData)
    ctypes.windll.kernel32.LocalFree(blob_out.pbData)
    return out


def _protect(s: str) -> dict:
    raw = s.encode("utf-8")
    if sys.platform == "win32":
        return {"m": "dpapi", "v": base64.b64encode(_dpapi(raw, True)).decode()}
    return {"m": "plain-b64", "v": base64.b64encode(raw).decode()}  # non-Windows dev: protected by file permissions


def _unprotect(d: dict) -> str:
    raw = base64.b64decode(d["v"])
    if d.get("m") == "dpapi":
        raw = _dpapi(raw, False)
    return raw.decode("utf-8")


def _load() -> dict:
    if not config.SECRETS_PATH.exists():
        return {}
    return json.loads(config.SECRETS_PATH.read_text(encoding="utf-8") or "{}")


def _save(d: dict) -> None:
    config.SECRETS_PATH.write_text(json.dumps(d), encoding="utf-8")
    try:
        os.chmod(config.SECRETS_PATH, 0o600)
    except OSError:
        pass


def set_key(provider_id: str, key: str) -> None:
    with _lock:
        d = _load()
        if key:
            d[provider_id] = _protect(key)
        else:
            d.pop(provider_id, None)
        _save(d)


def get_key(provider_id: str) -> str | None:
    with _lock:
        v = _load().get(provider_id)
    return _unprotect(v) if v else None


def mask(key: str | None) -> str | None:
    if not key:
        return None
    return "••••" + key[-4:] if len(key) > 4 else "••••"
