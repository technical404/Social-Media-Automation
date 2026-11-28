import { describe, expect, it } from "vitest";
import { OAUTH_CALLBACK_URL, OAUTH_PLATFORMS, oauthRedirectWarning } from "@/lib/platform-oauth";
import { PLATFORMS } from "@/lib/platforms";

describe("OAuth platform registry", () => {
  it("covers every social platform exactly once", () => {
    expect(Object.keys(OAUTH_PLATFORMS).sort()).toEqual([...PLATFORMS].sort());
  });

  it("points the callback at the local backend", () => {
    expect(OAUTH_CALLBACK_URL.endsWith("/api/oauth/callback")).toBe(true);
    expect(OAUTH_CALLBACK_URL.startsWith("http://127.0.0.1")).toBe(true);
  });

  it("warns when a provider needs HTTPS but the redirect is local HTTP", () => {
    expect(oauthRedirectWarning("linkedin", "http://127.0.0.1:8765/api/oauth/callback")).toMatch(
      /HTTPS/,
    );
    expect(oauthRedirectWarning("tiktok", "http://127.0.0.1:8765/api/oauth/callback")).toMatch(
      /HTTPS/,
    );
    expect(oauthRedirectWarning("youtube", "http://127.0.0.1:8765/api/oauth/callback")).toBeNull();
  });

  it("rejects non-local HTTP redirects", () => {
    expect(oauthRedirectWarning("instagram", "http://example.com/callback")).toMatch(
      /must be HTTPS/,
    );
    expect(oauthRedirectWarning("instagram", "https://example.com/callback")).toBeNull();
  });
});
