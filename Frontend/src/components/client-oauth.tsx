import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OAuthAppDialog } from "@/components/oauth-app-dialog";
import { backendFetch } from "@/lib/db/python";
import { envQuery } from "@/lib/hooks";
import { OAUTH_PLATFORMS } from "@/lib/platform-oauth";
import * as repo from "@/lib/repo";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  connected: { label: "Connected", className: "bg-success/15 text-success" },
  not_connected: { label: "Not connected", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-warning text-warning-foreground" },
  error: { label: "Needs attention", className: "bg-destructive/15 text-destructive" },
};

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Per-client OAuth connections for every supported platform. The token exchange
 * happens in the local Python backend, so this is disabled in browser-only mode.
 */
export function ClientOAuth({ client }: { client: repo.Client }) {
  const qc = useQueryClient();
  const { data: env } = useQuery(envQuery);
  const isPython = env?.mode === "python";
  const { data: connections = [] } = useQuery({
    queryKey: ["social-connections", client.id],
    queryFn: () => repo.listClientSocialConnections(client.id),
  });
  const { data: apps = [] } = useQuery({
    queryKey: ["social-oauth-apps"],
    queryFn: repo.listSocialOAuthApps,
  });
  const [dialogPlatform, setDialogPlatform] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const byPlatform = new Map(connections.map((c) => [c.platform, c]));
  const appFor = (platform: string) =>
    apps.find((a) => a.platform === platform && a.client_id === client.id) ??
    apps.find((a) => a.platform === platform && !a.client_id) ??
    null;

  // The provider callback lands in another tab; refresh when the user comes back.
  useEffect(() => {
    const onFocus = () => qc.invalidateQueries({ queryKey: ["social-connections", client.id] });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc, client.id]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["social-connections", client.id] });
    qc.invalidateQueries({ queryKey: ["social-oauth-apps"] });
  }

  async function connect(platform: string) {
    if (!isPython)
      return void toast.error(
        "OAuth needs the local Python backend. Start the app with python main.py.",
      );
    const app = appFor(platform);
    if (!app || !app.app_client_id || (platform !== "x" && !app.has_client_secret)) {
      setDialogPlatform(platform);
      return void toast.error("Add this platform's OAuth app credentials first.");
    }
    setBusy(platform);
    // Open the tab synchronously so the browser does not block it after the awaits.
    const popup = window.open("about:blank", "_blank");
    try {
      const conn = await repo.ensureSocialConnection(client.id, platform);
      const res = await backendFetch("/api/oauth/start", {
        method: "POST",
        body: JSON.stringify({ connection_id: conn.id }),
      });
      const { authorize_url } = (await res.json()) as { authorize_url: string };
      if (popup) {
        popup.opener = null;
        popup.location.href = authorize_url;
      } else {
        location.assign(authorize_url);
        return;
      }
      toast.info("Approve access in the new tab, then return here.");
    } catch (e) {
      popup?.close();
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(platform: string) {
    const conn = byPlatform.get(platform);
    if (!conn) return;
    const label = OAUTH_PLATFORMS[platform]?.label ?? platform;
    if (
      !window.confirm(`Disconnect ${label} from ${client.name}? The stored tokens will be deleted.`)
    )
      return;
    setBusy(platform);
    try {
      await backendFetch("/api/oauth/disconnect", {
        method: "POST",
        body: JSON.stringify({ connection_id: conn.id }),
      });
      toast.success(`${label} disconnected`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function callConnection(platform: string, action: "test" | "refresh") {
    const conn = byPlatform.get(platform);
    if (!conn) return;
    setBusy(platform);
    try {
      await backendFetch(`/api/oauth/${action}`, {
        method: "POST",
        body: JSON.stringify({ connection_id: conn.id }),
      });
      toast.success(action === "test" ? "The connection is working." : "Token refreshed.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Client social connections"
      data-testid="client-oauth"
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
            <Link2 className="h-4 w-4" /> Social connections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Official OAuth only. Each platform is connected separately for {client.name}; passwords
            are never collected.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw /> Refresh status
        </Button>
      </div>

      {!isPython && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          OAuth is unavailable in browser-only mode. Start the app with <code>python main.py</code>{" "}
          so the local backend can perform the token exchange securely.
        </p>
      )}

      <ul className="divide-y rounded-xl border">
        {Object.values(OAUTH_PLATFORMS).map((info) => {
          const conn = byPlatform.get(info.platform);
          const status = conn?.status ?? "not_connected";
          const style = STATUS_STYLE[status] ??
            STATUS_STYLE["not_connected"] ?? { label: status, className: "bg-muted" };
          const app = appFor(info.platform);
          const working = busy === info.platform;
          const detail =
            status === "connected"
              ? [
                  conn?.display_name,
                  conn?.handle ? `@${conn.handle}` : "",
                  conn?.expires_at ? `expires ${shortDate(conn.expires_at)}` : "no expiry",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : conn?.last_error || info.setup;
          return (
            <li key={info.platform} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{info.label}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.className}`}
                  >
                    {style.label}
                  </span>
                  {app && (
                    <span className="text-[11px] text-muted-foreground">
                      {app.client_id ? "Client app" : "Workspace app"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isPython}
                  onClick={() => setDialogPlatform(info.platform)}
                >
                  <KeyRound /> App
                </Button>
                {status === "connected" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isPython || working}
                      onClick={() => callConnection(info.platform, "test")}
                    >
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isPython || working}
                      onClick={() => callConnection(info.platform, "refresh")}
                    >
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={!isPython || working}
                      onClick={() => disconnect(info.platform)}
                    >
                      <Unplug /> Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="highlight"
                    disabled={!isPython || working}
                    onClick={() => connect(info.platform)}
                  >
                    {working ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {status === "error" ? "Retry" : "Connect"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Need help creating a developer app? <ExternalLink className="h-3 w-3" /> Every platform's
        setup guide is in the “App” dialog.
      </p>

      {dialogPlatform && (
        <OAuthAppDialog
          open={!!dialogPlatform}
          onOpenChange={(open) => !open && setDialogPlatform(null)}
          platform={dialogPlatform}
          clientId={client.id}
          clientName={client.name}
          apps={apps}
          onSaved={() => {
            setDialogPlatform(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
