# Social integrations (OAuth)

Official OAuth 2.0 is implemented for every platform on every client. The app
never collects social passwords, and a connection only shows **Connected** after
the provider's token endpoint returns a real access token.

Publishing is still **EXTERNAL VERIFICATION PENDING**: OAuth proves the account
is connected, but per-platform publish adapters (media upload, pages, retries)
are the next step. Scheduled posts fail with an explicit reason until then; the
app never marks a post published without a platform confirmation.

## How the model works

| Layer | Where it lives | Contains |
| --- | --- | --- |
| OAuth developer app | `social_oauth_apps` + encrypted secret | App client ID, scopes, redirect URI. One **workspace** app per platform, optionally overridden per client. |
| Connection | `social_connections` + encrypted token | One row per **client + platform**: status, handle, external id, expiry, last error. |
| Secrets / tokens | `backend/secrets_store.py` | DPAPI-encrypted on Windows. Never in SQLite, backups or logs. |

A client-specific app (Clients → *Client* → Social connections → App → “This
client only”) takes precedence over the workspace app for that client. Remove the
client override in the same dialog to fall back to the workspace app.

## Setup

1. Start the app with `python main.py` so the local backend performs the token
   exchange. OAuth is disabled in browser-only mode.
2. Open **Social Accounts** and press **Configure** on each platform you use.
   Paste the app client ID and secret from the provider's developer console.
3. Register the redirect URI in the developer console. The default is
   `http://127.0.0.1:8765/api/oauth/callback`.
4. Open a client, scroll to **Social connections**, and press **Connect** for a
   platform. Approve access in the browser tab that opens.
5. Return to the app; the row becomes **Connected** with the account handle.
   Use **Verify** to re-check the token and **Refresh** to renew it.

## Redirect URIs

- Local HTTP callback: `http://127.0.0.1:8765/api/oauth/callback`
- If the backend port changes, update `SOCIALAI_OAUTH_REDIRECT_URI` and register
  the new URL. The callback host is accepted **only** on the callback endpoint;
  every other API route stays limited to `127.0.0.1`/`localhost`.
- LinkedIn, TikTok and Pinterest require **HTTPS** redirect URIs. For those,
  run an HTTPS tunnel that forwards to `127.0.0.1:8765` and set
  `SOCIALAI_OAUTH_REDIRECT_URI=https://your-tunnel.example/api/oauth/callback`
  before starting the app. Use the same URL in the OAuth app dialog and in the
  provider console.

## Platform notes

| Platform | Scopes requested | Redirect |
| --- | --- | --- |
| Instagram | `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | HTTP localhost allowed |
| Facebook | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata` | HTTP localhost allowed |
| LinkedIn | `openid`, `profile`, `w_member_social` | HTTPS required |
| X | `tweet.read`, `tweet.write`, `users.read`, `offline.access` | HTTP localhost allowed, PKCE |
| YouTube | `youtube.readonly`, `youtube.upload` | HTTP localhost allowed |
| TikTok | `user.info.basic`, `video.publish`, `video.upload` | HTTPS required, PKCE |
| Pinterest | `boards:read`, `pins:read`, `pins:write`, `user_accounts:read` | HTTPS required |

Scopes are editable in the app dialog when a provider changes its requirements.
X public clients may omit the client secret; every other platform needs one.

## Security

- The backend binds `127.0.0.1`, checks Host + Origin, and requires the session
  token on every API call except the provider callback.
- The callback is authorized by a one-time `state` value (10 minute TTL) and the
  authorization code, never by a URL token.
- Access/refresh tokens and app secrets are encrypted with Windows DPAPI. The UI
  only ever sees `has_client_secret` and a masked hint.
- Disconnecting deletes the stored token. Deleting a client deletes its
  connections, client-specific apps and encrypted tokens.
- Database backups exclude the encrypted store. After a restore, connections
  whose tokens are absent or cannot be decrypted on this PC are marked for
  reconnection rather than shown as connected.
