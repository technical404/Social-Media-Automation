// Shared OAuth facts for the UI. The Python backend (backend/oauth.py) is the
// source of truth for the actual flow; this module only labels and explains it.
import { BACKEND_URL } from "./db/python";

export type OAuthTokenAuth = "body" | "basic" | "client_key";

export type OAuthPlatformInfo = {
  platform: string;
  label: string;
  scopes: string;
  tokenAuth: OAuthTokenAuth;
  pkce: boolean;
  requiresHttpsRedirect: boolean;
  docsUrl: string;
  setup: string;
};

export const OAUTH_PLATFORMS: Record<string, OAuthPlatformInfo> = {
  instagram: {
    platform: "instagram",
    label: "Instagram",
    scopes:
      "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts",
    tokenAuth: "body",
    pkce: false,
    requiresHttpsRedirect: false,
    docsUrl:
      "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login",
    setup:
      "Create a Meta app with Instagram Graph API + Facebook Login. Instagram publishing needs a Business or Creator account linked to a Facebook Page.",
  },
  facebook: {
    platform: "facebook",
    label: "Facebook",
    scopes: "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata",
    tokenAuth: "body",
    pkce: false,
    requiresHttpsRedirect: false,
    docsUrl: "https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow",
    setup:
      "Create a Meta app with Facebook Login. Use the same app client ID and secret as Instagram if you want one consent flow.",
  },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    scopes: "openid profile w_member_social",
    tokenAuth: "body",
    pkce: false,
    requiresHttpsRedirect: true,
    docsUrl:
      "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
    setup:
      "Create a LinkedIn developer app and request the “Share on LinkedIn” product. LinkedIn requires an HTTPS redirect URL.",
  },
  x: {
    platform: "x",
    label: "X",
    scopes: "tweet.read tweet.write users.read offline.access",
    tokenAuth: "basic",
    pkce: true,
    requiresHttpsRedirect: false,
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code",
    setup:
      "Create an X app with OAuth 2.0. Use PKCE; a client secret is optional for public clients.",
  },
  youtube: {
    platform: "youtube",
    label: "YouTube",
    scopes:
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
    tokenAuth: "body",
    pkce: false,
    requiresHttpsRedirect: false,
    docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server",
    setup:
      "Create a Google Cloud OAuth client (Web application). Google allows http://127.0.0.1 redirects for local apps.",
  },
  tiktok: {
    platform: "tiktok",
    label: "TikTok",
    scopes: "user.info.basic,video.publish,video.upload",
    tokenAuth: "client_key",
    pkce: true,
    requiresHttpsRedirect: true,
    docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
    setup:
      "Create a TikTok developer app with Login Kit + Content Posting API. TikTok requires an HTTPS redirect URL.",
  },
  pinterest: {
    platform: "pinterest",
    label: "Pinterest",
    scopes: "boards:read,pins:read,pins:write,user_accounts:read",
    tokenAuth: "basic",
    pkce: false,
    requiresHttpsRedirect: true,
    docsUrl: "https://developers.pinterest.com/docs/getting-started/authentication/",
    setup:
      "Create a Pinterest developer app. Pinterest requires an HTTPS redirect URL and uses HTTP Basic auth at the token endpoint.",
  },
};

/** Local callback served by the Python backend. Register this exact URL in the developer app. */
export const OAUTH_CALLBACK_URL = `${BACKEND_URL.replace(/\/$/, "")}/api/oauth/callback`;

export function oauthPlatformInfo(platform: string): OAuthPlatformInfo | undefined {
  return OAUTH_PLATFORMS[platform];
}

/** A visible warning when the configured redirect cannot satisfy the provider. */
export function oauthRedirectWarning(platform: string, redirectUri: string): string | null {
  const info = oauthPlatformInfo(platform);
  if (!info) return "Unknown platform.";
  if (info.requiresHttpsRedirect && redirectUri.startsWith("http://")) {
    return `${info.label} requires an HTTPS redirect URI. Use a public HTTPS tunnel that forwards to this local callback, or the provider will refuse the sign-in.`;
  }
  if (
    !redirectUri.startsWith("http://127.0.0.1") &&
    !redirectUri.startsWith("http://localhost") &&
    !redirectUri.startsWith("https://")
  ) {
    return "Redirect URI must be HTTPS or a local http://127.0.0.1 address.";
  }
  return null;
}
