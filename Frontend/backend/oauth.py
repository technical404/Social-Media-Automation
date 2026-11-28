"""Official OAuth 2.0 authorization-code flow for social platforms.

Rules:
- The backend performs every token exchange. The browser never sees app secrets
  or access tokens.
- App secrets and tokens live only in backend.secrets_store (DPAPI-encrypted on
  Windows). SQLite stores non-secret connection metadata.
- A connection becomes "connected" only after the provider's token endpoint
  returns a real access token. Nothing is faked.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import secrets as pysecrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import config, db, secrets_store

META_GRAPH = "https://graph.facebook.com/v21.0"
USER_AGENT = "SocialAI-Studio/1.0"
STATE_TTL_SECONDS = 600
HTTP_TIMEOUT_SECONDS = 30

# Providers that accept a public client (no client secret) with PKCE.
SECRET_OPTIONAL = {"x"}


class OAuthError(Exception):
    """A safe, user-facing OAuth failure. Never contains tokens or secrets."""


@dataclass(frozen=True)
class Platform:
    id: str
    label: str
    authorize_url: str
    token_url: str
    default_scopes: str
    docs_url: str
    token_auth: str = "body"  # body | basic | client_key
    pkce: bool = False
    requires_https_redirect: bool = False
    extra_authorize: tuple[tuple[str, str], ...] = ()


PLATFORMS: dict[str, Platform] = {
    "instagram": Platform(
        id="instagram",
        label="Instagram",
        authorize_url="https://www.facebook.com/v21.0/dialog/oauth",
        token_url=f"{META_GRAPH}/oauth/access_token",
        default_scopes="instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts",
        docs_url="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login",
    ),
    "facebook": Platform(
        id="facebook",
        label="Facebook",
        authorize_url="https://www.facebook.com/v21.0/dialog/oauth",
        token_url=f"{META_GRAPH}/oauth/access_token",
        default_scopes="pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata",
        docs_url="https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow",
    ),
    "linkedin": Platform(
        id="linkedin",
        label="LinkedIn",
        authorize_url="https://www.linkedin.com/oauth/v2/authorization",
        token_url="https://www.linkedin.com/oauth/v2/accessToken",
        default_scopes="openid profile w_member_social",
        docs_url="https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
        requires_https_redirect=True,
    ),
    "x": Platform(
        id="x",
        label="X",
        authorize_url="https://twitter.com/i/oauth2/authorize",
        token_url="https://api.twitter.com/2/oauth2/token",
        default_scopes="tweet.read tweet.write users.read offline.access",
        docs_url="https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code",
        token_auth="basic",
        pkce=True,
    ),
    "youtube": Platform(
        id="youtube",
        label="YouTube",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        default_scopes="https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
        docs_url="https://developers.google.com/identity/protocols/oauth2/web-server",
        extra_authorize=(("access_type", "offline"), ("prompt", "consent"), ("include_granted_scopes", "true")),
    ),
    "tiktok": Platform(
        id="tiktok",
        label="TikTok",
        authorize_url="https://www.tiktok.com/v2/auth/authorize/",
        token_url="https://open.tiktokapis.com/v2/oauth/token/",
        default_scopes="user.info.basic,video.publish,video.upload",
        docs_url="https://developers.tiktok.com/doc/login-kit-web",
        token_auth="client_key",
        pkce=True,
        requires_https_redirect=True,
    ),
    "pinterest": Platform(
        id="pinterest",
        label="Pinterest",
        authorize_url="https://www.pinterest.com/oauth/",
        token_url="https://api.pinterest.com/v5/oauth/token",
        default_scopes="boards:read,pins:read,pins:write,user_accounts:read",
        docs_url="https://developers.pinterest.com/docs/getting-started/authentication/",
        token_auth="basic",
        requires_https_redirect=True,
    ),
}

# ---------- small helpers ----------

_STATES: dict[str, dict] = {}
_state_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def make_pkce() -> tuple[str, str]:
    """Return (verifier, S256 challenge) for PKCE-enabled providers."""
    verifier = base64.urlsafe_b64encode(pysecrets.token_bytes(48)).decode("ascii").rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
    return verifier, challenge


def build_authorize_url(
    platform: str,
    app_client_id: str,
    redirect_uri: str,
    scopes: str,
    state: str,
    code_challenge: str | None = None,
) -> str:
    """Build the provider consent URL. Pure: no database or network access."""
    p = PLATFORMS.get(platform)
    if not p:
        raise OAuthError("Unknown platform.")
    params: dict[str, str] = {
        "response_type": "code",
        "client_key" if p.token_auth == "client_key" else "client_id": app_client_id,
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
    }
    if p.pkce and code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    params.update(dict(p.extra_authorize))
    return f"{p.authorize_url}?{urllib.parse.urlencode(params)}"


def validate_redirect_uri(redirect_uri: str) -> None:
    u = urllib.parse.urlsplit(redirect_uri)
    if u.scheme == "https" and u.netloc:
        return
    if u.scheme == "http" and u.hostname in {"127.0.0.1", "localhost", "::1"}:
        return
    raise OAuthError("Redirect URI must be HTTPS or a local http://127.0.0.1 address.")


def _short(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace").strip().replace("\n", " ")
    return text[:300] + ("…" if len(text) > 300 else "")


def _request_json(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    form: dict[str, str] | None = None,
    method: str = "GET",
    timeout: float = HTTP_TIMEOUT_SECONDS,
) -> dict:
    data = urllib.parse.urlencode(form).encode("ascii") if form is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(2_000_000)
    except urllib.error.HTTPError as e:
        raise OAuthError(f"The provider returned HTTP {e.code}: {_short(e.read(4000))}") from None
    except urllib.error.URLError as e:
        raise OAuthError(f"Could not reach the provider: {e.reason}") from None
    text = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except ValueError:
        query = urllib.parse.parse_qs(text)
        if query:
            return {k: v[0] for k, v in query.items()}
        raise OAuthError("The provider did not return a readable response.") from None
    if not isinstance(parsed, dict):
        raise OAuthError("The provider returned an unexpected response.")
    return parsed


def _expires_at(expires_in) -> str | None:
    if expires_in in (None, ""):
        return None
    try:
        moment = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    except (TypeError, ValueError):
        return None
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _normalize_token(data: dict) -> dict:
    if data.get("error"):
        raise OAuthError(str(data.get("error_description") or data.get("error")))
    access = data.get("access_token") or data.get("accessToken")
    if not access:
        raise OAuthError("The provider did not return an access token.")
    return {
        "access_token": str(access),
        "refresh_token": str(data.get("refresh_token") or data.get("refreshToken") or ""),
        "token_type": str(data.get("token_type") or data.get("tokenType") or "Bearer"),
        "scope": str(data.get("scope") or ""),
        "expires_at": _expires_at(data.get("expires_in") or data.get("expiresIn")),
    }


# ---------- provider calls ----------

def _extend_facebook_token(p: Platform, client_id: str, secret: str, token: dict) -> dict:
    """Swap a short-lived Meta user token for a long-lived one."""
    query = urllib.parse.urlencode(
        {
            "grant_type": "fb_exchange_token",
            "client_id": client_id,
            "client_secret": secret,
            "fb_exchange_token": token["access_token"],
        }
    )
    try:
        data = _request_json(f"{p.token_url}?{query}")
    except OAuthError:
        return token
    if data.get("access_token"):
        token = {
            **token,
            "access_token": str(data["access_token"]),
            "expires_at": _expires_at(data.get("expires_in")) or token.get("expires_at"),
        }
    return token


def exchange_code(platform: str, app: dict, code: str, redirect_uri: str, code_verifier: str | None) -> dict:
    """Exchange an authorization code for tokens. Raises OAuthError on failure."""
    p = PLATFORMS.get(platform)
    if not p:
        raise OAuthError("Unknown platform.")
    client_id = str(app.get("app_client_id") or "")
    secret = str(app.get("client_secret") or "")
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    form: dict[str, str] = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri}
    if p.token_auth == "client_key":
        form.update({"client_key": client_id, "client_secret": secret})
    elif p.token_auth == "basic":
        if secret:
            headers["Authorization"] = "Basic " + base64.b64encode(f"{client_id}:{secret}".encode()).decode()
        else:
            form["client_id"] = client_id
    else:
        form["client_id"] = client_id
        if secret:
            form["client_secret"] = secret
    if p.pkce and code_verifier:
        form["code_verifier"] = code_verifier
    data = _request_json(p.token_url, headers=headers, form=form, method="POST")
    token = _normalize_token(data)
    if platform in {"facebook", "instagram"} and secret:
        token = _extend_facebook_token(p, client_id, secret, token)
    return token


def refresh_access_token(platform: str, app: dict, token: dict) -> dict:
    """Refresh (or re-extend) a token. Raises OAuthError when the provider offers no refresh path."""
    p = PLATFORMS.get(platform)
    if not p:
        raise OAuthError("Unknown platform.")
    client_id = str(app.get("app_client_id") or "")
    secret = str(app.get("client_secret") or "")
    if platform in {"facebook", "instagram"}:
        if not secret:
            raise OAuthError("Meta token refresh needs the app client secret.")
        return _extend_facebook_token(p, client_id, secret, token)
    refresh_token = str(token.get("refresh_token") or "")
    if not refresh_token:
        raise OAuthError("This connection has no refresh token. Reconnect the account instead.")
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    form: dict[str, str] = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    if p.token_auth == "client_key":
        form.update({"client_key": client_id, "client_secret": secret})
    elif p.token_auth == "basic":
        if secret:
            headers["Authorization"] = "Basic " + base64.b64encode(f"{client_id}:{secret}".encode()).decode()
        else:
            form["client_id"] = client_id
    else:
        form["client_id"] = client_id
        if secret:
            form["client_secret"] = secret
    data = _request_json(p.token_url, headers=headers, form=form, method="POST")
    new_token = _normalize_token(data)
    if not new_token.get("refresh_token"):
        new_token["refresh_token"] = refresh_token
    if not new_token.get("scope"):
        new_token["scope"] = str(token.get("scope") or "")
    return new_token


def fetch_profile(platform: str, access_token: str) -> dict:
    """Return {external_id, display_name, handle}. Raises OAuthError on failure."""
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json", "User-Agent": USER_AGENT}
    if platform == "instagram":
        data = _request_json(f"{META_GRAPH}/me/accounts?fields=name,id,instagram_business_account{{id,username}}", headers=headers)
        for page in data.get("data", []) if isinstance(data.get("data"), list) else []:
            business = page.get("instagram_business_account") if isinstance(page, dict) else None
            if business:
                return {
                    "external_id": str(business.get("id") or ""),
                    "display_name": str(page.get("name") or ""),
                    "handle": str(business.get("username") or ""),
                }
        fallback = _request_json(f"{META_GRAPH}/me?fields=id,name", headers=headers)
        return {"external_id": str(fallback.get("id") or ""), "display_name": str(fallback.get("name") or ""), "handle": ""}
    if platform == "facebook":
        data = _request_json(f"{META_GRAPH}/me?fields=id,name", headers=headers)
        return {"external_id": str(data.get("id") or ""), "display_name": str(data.get("name") or ""), "handle": ""}
    if platform == "linkedin":
        data = _request_json("https://api.linkedin.com/v2/userinfo", headers=headers)
        return {
            "external_id": str(data.get("sub") or ""),
            "display_name": str(data.get("name") or ""),
            "handle": str(data.get("preferred_username") or ""),
        }
    if platform == "x":
        data = _request_json("https://api.twitter.com/2/users/me", headers=headers)
        user = data.get("data") if isinstance(data.get("data"), dict) else {}
        return {
            "external_id": str(user.get("id") or ""),
            "display_name": str(user.get("name") or ""),
            "handle": str(user.get("username") or ""),
        }
    if platform == "youtube":
        data = _request_json(
            "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", headers=headers
        )
        items = data.get("items") if isinstance(data.get("items"), list) else []
        if items:
            first = items[0] if isinstance(items[0], dict) else {}
            snippet = first.get("snippet") if isinstance(first.get("snippet"), dict) else {}
            return {
                "external_id": str(first.get("id") or ""),
                "display_name": str(snippet.get("title") or ""),
                "handle": "",
            }
        return {}
    if platform == "tiktok":
        data = _request_json(
            "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", headers=headers
        )
        user = data.get("data", {}).get("user", {}) if isinstance(data.get("data"), dict) else {}
        return {
            "external_id": str(user.get("open_id") or ""),
            "display_name": str(user.get("display_name") or ""),
            "handle": str(user.get("username") or ""),
        }
    if platform == "pinterest":
        data = _request_json("https://api.pinterest.com/v5/user_account", headers=headers)
        return {
            "external_id": str(data.get("id") or ""),
            "display_name": str(data.get("username") or ""),
            "handle": str(data.get("username") or ""),
        }
    raise OAuthError("Unknown platform.")


# ---------- state ----------

def _remember_state(state: str, payload: dict) -> None:
    now = time.time()
    with _state_lock:
        for key, entry in list(_STATES.items()):
            if now - entry["created_at"] > STATE_TTL_SECONDS:
                del _STATES[key]
        _STATES[state] = {**payload, "created_at": now}


def _pop_state(state: str) -> dict | None:
    with _state_lock:
        entry = _STATES.pop(state, None)
    if not entry:
        return None
    if time.time() - entry["created_at"] > STATE_TTL_SECONDS:
        return None
    return entry


# ---------- database (non-secret metadata only) ----------

def _app_row(conn, app_id: str) -> dict | None:
    with db._lock:
        row = conn.execute("SELECT * FROM social_oauth_apps WHERE id = ?", (app_id,)).fetchone()
    if not row:
        return None
    app = dict(row)
    app["client_secret"] = _read_secret(f"oauth-app:{app['id']}") or ""
    return app


def resolve_app(conn, platform: str, client_id: str | None) -> dict | None:
    """Client-specific app wins; otherwise the workspace app. Only enabled rows."""
    with db._lock:
        row = conn.execute(
            "SELECT * FROM social_oauth_apps WHERE platform = ? AND enabled = 1 "
            "AND (client_id = ? OR client_id IS NULL) "
            "ORDER BY CASE WHEN client_id IS NULL THEN 1 ELSE 0 END LIMIT 1",
            (platform, client_id),
        ).fetchone()
    if not row:
        return None
    app = dict(row)
    app["client_secret"] = _read_secret(f"oauth-app:{app['id']}") or ""
    return app


def _connection_row(conn, connection_id: str) -> dict:
    with db._lock:
        row = conn.execute("SELECT * FROM social_connections WHERE id = ?", (connection_id,)).fetchone()
    if not row:
        raise OAuthError("This connection no longer exists.")
    return dict(row)


def _read_secret(key: str) -> str | None:
    try:
        return secrets_store.get_key(key)
    except Exception:  # noqa: BLE001 - DPAPI failure, not a missing value
        raise OAuthError(
            "The encrypted secret store could not be read on this PC. Re-enter the OAuth app credentials."
        ) from None


def _save_token(connection_id: str, token: dict) -> None:
    secrets_store.set_key(f"oauth-token:{connection_id}", json.dumps(token))


def _load_token(connection_id: str) -> dict:
    raw = _read_secret(f"oauth-token:{connection_id}")
    if not raw:
        raise OAuthError("No tokens are stored for this connection. Connect the account again.")
    try:
        token = json.loads(raw)
    except ValueError:
        raise OAuthError("Stored tokens are unreadable. Connect the account again.") from None
    if not isinstance(token, dict) or not token.get("access_token"):
        raise OAuthError("Stored tokens are incomplete. Connect the account again.")
    return token


def save_app(conn, payload: dict) -> dict:
    """Create/update an OAuth app. The secret is written to the encrypted store."""
    platform = str(payload.get("platform") or "").strip().lower()
    if platform not in PLATFORMS:
        raise OAuthError("Choose a supported platform.")
    client_id = payload.get("client_id") or None
    app_client_id = str(payload.get("app_client_id") or "").strip()
    if not app_client_id:
        raise OAuthError("The app client ID is required.")
    if len(app_client_id) > 300:
        raise OAuthError("The app client ID is too long.")
    redirect_uri = str(payload.get("redirect_uri") or "").strip() or config.OAUTH_REDIRECT_URI
    validate_redirect_uri(redirect_uri)
    scopes = str(payload.get("scopes") or "").strip() or PLATFORMS[platform].default_scopes
    enabled = 1 if payload.get("enabled", True) else 0
    with db._lock:
        if client_id:
            exists = conn.execute("SELECT 1 FROM clients WHERE id = ?", (client_id,)).fetchone()
            if not exists:
                raise OAuthError("That client no longer exists.")
        row = conn.execute(
            "SELECT * FROM social_oauth_apps WHERE platform = ? AND ifnull(client_id, '') = ifnull(?, '')",
            (platform, client_id),
        ).fetchone()
        app_id = str(row["id"]) if row else str(uuid.uuid4())
        has_secret = int(row["has_client_secret"]) if row else 0
        hint = row["app_client_secret_hint"] if row else None
        secret_key = f"oauth-app:{app_id}"
        if "client_secret" in payload:
            supplied = payload.get("client_secret")
            if supplied in (None, ""):
                secrets_store.set_key(secret_key, "")
                has_secret, hint = 0, None
            else:
                text = str(supplied).strip()
                if len(text) > 500:
                    raise OAuthError("The app client secret is too long.")
                secrets_store.set_key(secret_key, text)
                has_secret, hint = 1, secrets_store.mask(text)
        now = now_iso()
        if row:
            conn.execute(
                "UPDATE social_oauth_apps SET app_client_id=?, app_client_secret_hint=?, has_client_secret=?, "
                "redirect_uri=?, scopes=?, enabled=?, updated_at=? WHERE id=?",
                (app_client_id, hint, has_secret, redirect_uri, scopes, enabled, now, app_id),
            )
        else:
            conn.execute(
                "INSERT INTO social_oauth_apps(id,platform,client_id,app_client_id,app_client_secret_hint,"
                "has_client_secret,redirect_uri,scopes,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (app_id, platform, client_id, app_client_id, hint, has_secret, redirect_uri, scopes, enabled, now, now),
            )
    return {
        "id": app_id,
        "platform": platform,
        "client_id": client_id,
        "app_client_id": app_client_id,
        "app_client_secret_hint": hint,
        "has_client_secret": has_secret,
        "redirect_uri": redirect_uri,
        "scopes": scopes,
        "enabled": enabled,
    }


def delete_app(conn, platform: str, client_id: str | None) -> dict:
    """Remove an OAuth app row and its encrypted secret. Idempotent."""
    platform = str(platform or "").strip().lower()
    if platform not in PLATFORMS:
        raise OAuthError("Choose a supported platform.")
    with db._lock:
        row = conn.execute(
            "SELECT id FROM social_oauth_apps WHERE platform = ? AND ifnull(client_id, '') = ifnull(?, '')",
            (platform, client_id or None),
        ).fetchone()
        if row:
            secrets_store.set_key(f"oauth-app:{row['id']}", "")
            conn.execute("DELETE FROM social_oauth_apps WHERE id = ?", (row["id"],))
    return {"ok": True}


def begin(conn, connection_id: str) -> str:
    """Create a one-time state and return the provider consent URL."""
    connection = _connection_row(conn, connection_id)
    platform = str(connection["platform"])
    p = PLATFORMS.get(platform)
    if not p:
        raise OAuthError("This connection uses an unsupported platform.")
    app = resolve_app(conn, platform, connection.get("client_id"))
    if not app:
        raise OAuthError("No OAuth app is configured for this platform. Add its client ID and secret first.")
    if not app.get("app_client_id"):
        raise OAuthError("The OAuth app has no client ID. Add it first.")
    if not app.get("client_secret") and platform not in SECRET_OPTIONAL:
        raise OAuthError("The OAuth app has no client secret stored. Add it first.")
    redirect_uri = app.get("redirect_uri") or config.OAUTH_REDIRECT_URI
    validate_redirect_uri(redirect_uri)
    scopes = app.get("scopes") or p.default_scopes
    state = pysecrets.token_urlsafe(32)
    verifier, challenge = make_pkce() if p.pkce else (None, None)
    _remember_state(
        state,
        {
            "connection_id": connection_id,
            "app_id": app["id"],
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
    )
    return build_authorize_url(platform, app["app_client_id"], redirect_uri, scopes, state, challenge)


def _mark_error(conn, connection_id: str, message: str) -> None:
    with db._lock:
        conn.execute(
            "UPDATE social_connections SET status='error', last_error=?, updated_at=? WHERE id=?",
            (message[:500], now_iso(), connection_id),
        )


def _mark_connected(conn, connection_id: str, platform: str, token: dict, profile: dict) -> None:
    current = _connection_row(conn, connection_id)
    display_name = str(profile.get("display_name") or current.get("display_name") or "")
    handle = str(profile.get("handle") or current.get("handle") or "")
    external_id = str(profile.get("external_id") or current.get("external_id") or "") or None
    now = now_iso()
    connected_at = current.get("connected_at") or now
    with db._lock:
        conn.execute(
            "UPDATE social_connections SET status='connected', handle=?, display_name=?, external_id=?, "
            "scopes=?, token_type=?, expires_at=?, connected_at=?, last_refreshed_at=?, last_error=NULL, updated_at=? "
            "WHERE id=?",
            (
                handle,
                display_name,
                external_id,
                str(token.get("scope") or ""),
                str(token.get("token_type") or "Bearer"),
                token.get("expires_at"),
                connected_at,
                now,
                now,
                connection_id,
            ),
        )


def complete(conn, params: dict) -> tuple[int, str]:
    """Handle the provider redirect. Returns (HTTP status, HTML page)."""
    if params.get("error"):
        detail = params.get("error_description") or params.get("error") or "The provider refused the request."
        return 400, _page(False, "Authorization was not completed", detail)
    state = str(params.get("state") or "")
    entry = _pop_state(state)
    if not entry:
        return 400, _page(
            False,
            "This sign-in link has expired",
            "Return to Social AI Studio and start the connection again.",
        )
    code = str(params.get("code") or "")
    if not code:
        return 400, _page(False, "Missing authorization code", "The provider did not return a code.")
    try:
        connection = _connection_row(conn, entry["connection_id"])
    except OAuthError as e:
        return 400, _page(False, "Connection missing", str(e))
    platform = str(connection["platform"])
    p = PLATFORMS.get(platform)
    app = _app_row(conn, entry["app_id"])
    if not p or not app:
        return 400, _page(False, "OAuth app missing", "The OAuth app configuration was removed. Start again.")
    try:
        token = exchange_code(platform, app, code, entry["redirect_uri"], entry.get("code_verifier"))
        try:
            profile = fetch_profile(platform, token["access_token"])
        except Exception:  # noqa: BLE001 - a profile lookup must not discard a real token
            profile = {}
    except OAuthError as e:
        _mark_error(conn, entry["connection_id"], str(e))
        return 400, _page(False, "Could not connect the account", str(e))
    _save_token(entry["connection_id"], token)
    _mark_connected(conn, entry["connection_id"], platform, token, profile)
    return 200, _page(
        True,
        f"{p.label} connected",
        "The account is connected for this client. You can close this tab and return to Social AI Studio.",
    )


def refresh(conn, connection_id: str) -> dict:
    connection = _connection_row(conn, connection_id)
    platform = str(connection["platform"])
    if platform not in PLATFORMS:
        raise OAuthError("This connection uses an unsupported platform.")
    app = resolve_app(conn, platform, connection.get("client_id"))
    if not app:
        raise OAuthError("The OAuth app for this platform is missing. Add it again.")
    current = _load_token(connection_id)
    try:
        new_token = refresh_access_token(platform, app, current)
    except OAuthError as e:
        _mark_error(conn, connection_id, str(e))
        raise
    _save_token(connection_id, new_token)
    _mark_connected(conn, connection_id, platform, new_token, {})
    return {"ok": True, "expires_at": new_token.get("expires_at")}


def test_connection(conn, connection_id: str) -> dict:
    connection = _connection_row(conn, connection_id)
    platform = str(connection["platform"])
    token = _load_token(connection_id)
    try:
        profile = fetch_profile(platform, token["access_token"])
    except OAuthError as e:
        _mark_error(conn, connection_id, str(e))
        raise
    _mark_connected(conn, connection_id, platform, token, profile)
    return {"ok": True, "profile": profile}


def disconnect(conn, connection_id: str) -> dict:
    _connection_row(conn, connection_id)
    secrets_store.set_key(f"oauth-token:{connection_id}", "")
    with db._lock:
        conn.execute(
            "UPDATE social_connections SET status='not_connected', handle='', display_name='', external_id=NULL, "
            "scopes='', token_type='Bearer', expires_at=NULL, connected_at=NULL, last_refreshed_at=NULL, "
            "last_error=NULL, updated_at=? WHERE id=?",
            (now_iso(), connection_id),
        )
    return {"ok": True}


def cleanup_client(conn, client_id: str) -> int:
    """Delete encrypted tokens before a client is removed. Metadata rows cascade."""
    with db._lock:
        connections = conn.execute("SELECT id FROM social_connections WHERE client_id = ?", (client_id,)).fetchall()
        apps = conn.execute("SELECT id FROM social_oauth_apps WHERE client_id = ?", (client_id,)).fetchall()
    for row in connections:
        secrets_store.set_key(f"oauth-token:{row['id']}", "")
    for row in apps:
        secrets_store.set_key(f"oauth-app:{row['id']}", "")
    # If the caller's metadata delete fails, do not leave a "connected" row.
    with db._lock:
        conn.execute(
            "UPDATE social_connections SET status='not_connected', handle='', display_name='', "
            "external_id=NULL, scopes='', token_type='Bearer', expires_at=NULL, connected_at=NULL, "
            "last_refreshed_at=NULL, last_error=?, updated_at=? WHERE client_id=?",
            ("Disconnected because the client was removed.", now_iso(), client_id),
        )
    return len(connections)


def reconcile_connections(conn) -> int:
    """Keep status honest after a restore.

    Database backups do not include the encrypted secret store. Rows that claim
    to be connected (or to have an app secret) but have no encrypted value on
    this PC are marked as needing reconnection instead of pretending to work.
    """
    try:
        with db._lock:
            connections = conn.execute(
                "SELECT id FROM social_connections WHERE status = 'connected'"
            ).fetchall()
            apps = conn.execute("SELECT id FROM social_oauth_apps WHERE has_client_secret = 1").fetchall()
    except Exception:  # noqa: BLE001 - older backups may not have these tables yet
        return 0
    now = now_iso()
    changed = 0
    for row in connections:
        try:
            present = bool(secrets_store.get_key(f"oauth-token:{row['id']}"))
            message = "Stored token is missing on this PC. Reconnect the account."
        except Exception:  # noqa: BLE001 - unreadable is just as unusable
            present = False
            message = "Stored token cannot be decrypted on this PC. Reconnect the account."
        if present:
            continue
        with db._lock:
            conn.execute(
                "UPDATE social_connections SET status='not_connected', last_error=?, updated_at=? WHERE id=?",
                (message, now, row["id"]),
            )
        changed += 1
    for row in apps:
        try:
            present = bool(secrets_store.get_key(f"oauth-app:{row['id']}"))
        except Exception:  # noqa: BLE001
            present = False
        if present:
            continue
        with db._lock:
            conn.execute(
                "UPDATE social_oauth_apps SET has_client_secret=0, app_client_secret_hint=NULL, updated_at=? WHERE id=?",
                (now, row["id"]),
            )
    return changed


# ---------- callback page ----------

def _page(ok: bool, title: str, message: str) -> str:
    safe_title = html.escape(title)
    safe_message = html.escape(message)
    color = "#16a34a" if ok else "#dc2626"
    mark = "✓" if ok else "✕"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{safe_title} — SocialAI Studio</title>
<style>
  body {{ margin:0; font-family:Segoe UI,system-ui,-apple-system,sans-serif; background:#f6f7f9; color:#111827; }}
  main {{ max-width:34rem; margin:12vh auto; padding:2rem; background:#fff; border-radius:1rem;
          box-shadow:0 12px 40px rgba(15,23,42,.12); text-align:center; }}
  .mark {{ font-size:2.5rem; color:{color}; }}
  h1 {{ font-size:1.35rem; margin:1rem 0 .5rem; }}
  p {{ margin:0; color:#4b5563; line-height:1.5; }}
</style></head>
<body><main>
  <div class="mark">{mark}</div>
  <h1>{safe_title}</h1>
  <p>{safe_message}</p>
</main></body></html>"""


# Public alias for the server's callback error path.
callback_page = _page
