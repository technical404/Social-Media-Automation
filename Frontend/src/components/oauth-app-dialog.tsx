import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { backendFetch } from "@/lib/db/python";
import { OAUTH_CALLBACK_URL, oauthPlatformInfo, oauthRedirectWarning } from "@/lib/platform-oauth";
import * as repo from "@/lib/repo";

type Scope = "workspace" | "client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;
  /** A client id enables the "this client only" override option. */
  clientId: string | null;
  clientName?: string;
  apps: repo.SocialOAuthApp[];
  onSaved: () => void;
};

/**
 * Configure one platform's OAuth developer app. The client secret is posted to the
 * Python backend and stored encrypted; it is never written to SQLite or shown again.
 */
export function OAuthAppDialog({
  open,
  onOpenChange,
  platform,
  clientId,
  clientName,
  apps,
  onSaved,
}: Props) {
  const info = oauthPlatformInfo(platform);
  const override = clientId
    ? apps.find((a) => a.platform === platform && a.client_id === clientId)
    : undefined;
  const workspace = apps.find((a) => a.platform === platform && !a.client_id);
  const [scope, setScope] = useState<Scope>("workspace");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(clientId && override ? "client" : "workspace");
    // Only re-seed when the dialog opens or a different app is edited; depending
    // on the whole object would reset the form when the query refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId, override?.id]);

  const selected = scope === "client" && clientId ? override : workspace;

  async function removeOverride() {
    if (!clientId || !override) return;
    const label = clientName ?? "this client";
    if (
      !window.confirm(
        `Remove ${label}'s own ${info?.label ?? platform} app? The workspace app will be used instead.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await backendFetch("/api/oauth/app/delete", {
        method: "POST",
        body: JSON.stringify({ platform, client_id: clientId }),
      });
      toast.success("Client OAuth app removed");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {info?.label ?? platform} OAuth app
          </DialogTitle>
          <DialogDescription>
            {info?.setup ?? "Paste the developer app credentials issued by the platform."} The
            client secret is encrypted on this PC and never stored in the database.
          </DialogDescription>
        </DialogHeader>

        {clientId && (
          <div className="space-y-1.5">
            <Label>Credentials used for this client</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
              <SelectTrigger aria-label="OAuth app scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Workspace default (all clients)</SelectItem>
                <SelectItem value="client">{clientName ?? "This client"} only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A client-specific app overrides the workspace app for this client only.
            </p>
            {scope === "client" && override && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit text-destructive hover:text-destructive"
                onClick={removeOverride}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove client
                override
              </Button>
            )}
          </div>
        )}

        <AppForm
          key={`${platform}-${scope}-${selected?.id ?? "new"}`}
          platform={platform}
          scopesDefault={info?.scopes ?? ""}
          docsUrl={info?.docsUrl}
          clientId={scope === "client" ? clientId : null}
          app={selected}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function AppForm({
  platform,
  clientId,
  app,
  scopesDefault,
  docsUrl,
  onSaved,
}: {
  platform: string;
  clientId: string | null;
  app?: repo.SocialOAuthApp | undefined;
  scopesDefault: string;
  docsUrl?: string | undefined;
  onSaved: () => void;
}) {
  const [appClientId, setAppClientId] = useState(app?.app_client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState(app?.redirect_uri || OAUTH_CALLBACK_URL);
  const [scopes, setScopes] = useState(app?.scopes || scopesDefault);
  const [saving, setSaving] = useState(false);
  const warning = oauthRedirectWarning(platform, redirectUri);

  async function save() {
    if (!appClientId.trim()) return void toast.error("The app client ID is required.");
    if (!app?.has_client_secret && !clientSecret.trim() && platform !== "x") {
      return void toast.error("The app client secret is required.");
    }
    setSaving(true);
    try {
      await backendFetch("/api/oauth/app", {
        method: "POST",
        body: JSON.stringify({
          platform,
          client_id: clientId,
          app_client_id: appClientId.trim(),
          // Omitted when blank so an existing encrypted secret is kept.
          client_secret: clientSecret.trim() || undefined,
          redirect_uri: redirectUri.trim(),
          scopes: scopes.trim(),
          enabled: true,
        }),
      });
      toast.success("OAuth app saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="oauth-app-client-id">App client ID</Label>
        <Input
          id="oauth-app-client-id"
          value={appClientId}
          onChange={(e) => setAppClientId(e.target.value)}
          autoComplete="off"
          placeholder="Client ID / client key from the developer app"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oauth-app-secret">App client secret</Label>
        <Input
          id="oauth-app-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="new-password"
          placeholder={
            app?.has_client_secret
              ? `Stored ${app.app_client_secret_hint ?? ""} — leave blank to keep`
              : platform === "x"
                ? "Optional for public X clients"
                : "Required"
          }
        />
        <p className="text-xs text-muted-foreground">
          Encrypted with Windows DPAPI. It is never returned to the browser or saved in SQLite.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oauth-app-redirect">Redirect URI</Label>
        <Input
          id="oauth-app-redirect"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Register this exact URL as the OAuth redirect/callback URI in the developer app.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oauth-app-scopes">Scopes</Label>
        <Input id="oauth-app-scopes" value={scopes} onChange={(e) => setScopes(e.target.value)} />
      </div>

      {warning && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {warning}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline"
          >
            Provider setup guide <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span />
        )}
        <DialogFooter className="p-0">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <KeyRound />} Save OAuth app
          </Button>
        </DialogFooter>
      </div>
    </div>
  );
}
