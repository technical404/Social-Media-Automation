import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, Link2, ShieldCheck, Unplug } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { OAuthAppDialog } from "@/components/oauth-app-dialog";
import { Button } from "@/components/ui/button";
import { envQuery, useRefresh } from "@/lib/hooks";
import { OAUTH_PLATFORMS } from "@/lib/platform-oauth";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/accounts")({
  head: () => ({ meta: [{ title: "Social accounts — SocialAI Studio" }] }),
  component: AccountsPage,
});

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  connected: { label: "Connected", className: "bg-success/15 text-success" },
  not_connected: { label: "Not connected", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-warning text-warning-foreground" },
  error: { label: "Needs attention", className: "bg-destructive/15 text-destructive" },
};

function AccountsPage() {
  const refresh = useRefresh();
  const { data: env } = useQuery(envQuery);
  const isPython = env?.mode === "python";
  const { data: apps = [] } = useQuery({
    queryKey: ["social-oauth-apps"],
    queryFn: repo.listSocialOAuthApps,
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["social-connections"],
    queryFn: repo.listSocialConnections,
  });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const [dialogPlatform, setDialogPlatform] = useState<string | null>(null);

  const groups = clients
    .map((client) => ({ client, rows: connections.filter((c) => c.client_id === client.id) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Social accounts"
        subtitle="Official OAuth per platform and per client. No fake connected status."
      />

      {!isPython && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          OAuth is unavailable in browser-only mode. Start the app with <code>python main.py</code>{" "}
          so the local backend can exchange and encrypt tokens.
        </p>
      )}

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-4 w-4" /> Workspace OAuth apps
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Register one developer app per platform, then connect each client's account from that
            client's page. Client secrets are encrypted on this PC and never written to SQLite.
          </p>
        </div>
        <ul className="divide-y rounded-xl border">
          {Object.values(OAUTH_PLATFORMS).map((info) => {
            const app = apps.find((a) => a.platform === info.platform && !a.client_id);
            const configured =
              !!app?.app_client_id && (!!app?.has_client_secret || info.platform === "x");
            return (
              <li key={info.platform} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{info.label}</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        configured ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {configured ? "App configured" : "Not configured"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {app?.app_client_id
                      ? `Client ID ${app.app_client_id}${app.has_client_secret ? ` · secret ${app.app_client_secret_hint ?? "stored"}` : ""}`
                      : info.setup}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isPython}
                  onClick={() => setDialogPlatform(info.platform)}
                >
                  <KeyRound /> Configure
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
            <Link2 className="h-4 w-4" /> Client connections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every platform account connected through OAuth, grouped by client.
          </p>
        </div>

        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No connections yet. Configure an OAuth app above, then open a client and press Connect
            on a platform.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ client, rows }) => (
              <div key={client.id} className="rounded-xl border">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                  <p className="font-medium">{client.name}</p>
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    className="text-xs text-primary underline"
                  >
                    Manage connections
                  </Link>
                </div>
                <ul className="divide-y">
                  {rows.map((conn) => {
                    const style = STATUS_STYLE[conn.status] ??
                      STATUS_STYLE["not_connected"] ?? {
                        label: conn.status,
                        className: "bg-muted",
                      };
                    const label = OAUTH_PLATFORMS[conn.platform]?.label ?? conn.platform;
                    return (
                      <li key={conn.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{label}</span>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.className}`}
                            >
                              {style.label}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {conn.status === "connected"
                              ? [conn.display_name, conn.handle ? `@${conn.handle}` : ""]
                                  .filter(Boolean)
                                  .join(" · ") || "Connected"
                              : conn.last_error || "No account connected"}
                          </p>
                        </div>
                        {conn.status === "connected" && (
                          <ShieldCheck className="h-4 w-4 text-success" aria-label="Connected" />
                        )}
                        {conn.status !== "connected" && (
                          <Unplug
                            className="h-4 w-4 text-muted-foreground"
                            aria-label="Not connected"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {dialogPlatform && (
        <OAuthAppDialog
          open={!!dialogPlatform}
          onOpenChange={(open) => !open && setDialogPlatform(null)}
          platform={dialogPlatform}
          clientId={null}
          apps={apps}
          onSaved={() => {
            setDialogPlatform(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
