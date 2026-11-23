import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TIMEZONES } from "@/lib/dates";
import { envQuery, useAppSettings } from "@/lib/hooks";
import { BACKEND_URL } from "@/lib/db/python";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SocialAI Studio" },
      { name: "description", content: "Time zone, theme and local backend connection." },
      { property: "og:title", content: "Settings — SocialAI Studio" },
      { property: "og:description", content: "Time zone, theme and local backend connection." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const s = useAppSettings();
  const { data: env } = useQuery(envQuery);
  const set = async (k: string, v: string) => {
    await repo.setSetting(k, v);
    await repo.logActivity("settings.changed", `Setting "${k}" changed to ${v}`);
    qc.invalidateQueries();
    toast.success("Saved");
  };
  const zones = [...new Set([...TIMEZONES, ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])];
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="Stored in your local database." />
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
        <div className="space-y-1.5">
          <Label>App time zone (clock and new calendars)</Label>
          <Select value={s.timezone} onValueChange={(v) => set("timezone", v)}>
            <SelectTrigger className="w-72" aria-label="App time zone"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Theme</Label>
          <Select value={s.theme} onValueChange={(v) => set("theme", v)}>
            <SelectTrigger className="w-72" aria-label="Theme"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">Follow Windows</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm shadow-soft">
        <h2 className="text-lg font-semibold">Where your data lives</h2>
        <p>{env?.location ?? "…"}</p>
        {env?.mode === "browser" ? (
          <p className="text-muted-foreground">
            The PC backend ({BACKEND_URL}) isn't running, so data is kept in this browser only. On your Windows PC run <code className="rounded bg-muted px-1">python main.py</code> to store everything in a SQLite file and run the background worker.
          </p>
        ) : (
          <p className="text-muted-foreground">Backend version {env?.health?.version}, schema {env?.health?.schema}.</p>
        )}
        <Button variant="outline" size="sm" onClick={() => location.reload()}>Re-check connection</Button>
      </section>
    </div>
  );
}
