import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Download, FileJson, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { saveKey } from "@/lib/secrets";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { all, getDb } from "@/lib/db";
import { LATEST_SCHEMA } from "@/lib/db/migrations";
import { downloadFile, envQuery, useRefresh } from "@/lib/hooks";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/database")({
  head: () => ({
    meta: [
      { title: "Database & Backup — SocialAI Studio" },
      { name: "description", content: "Back up, restore and check your local SQLite database." },
      { property: "og:title", content: "Database & Backup — SocialAI Studio" },
      { property: "og:description", content: "Back up, restore and check your local SQLite database." },
    ],
  }),
  component: DatabasePage,
});

const TABLES = ["calendars", "events", "event_generation_runs", "ai_providers", "ai_request_logs", "activity_logs", "app_settings", "scheduler_jobs"];

function DatabasePage() {
  const refresh = useRefresh();
  const { data: env } = useQuery(envQuery);
  const { data: counts = [] } = useQuery({
    queryKey: ["db-counts"],
    queryFn: async () => Promise.all(TABLES.map(async (t) => ({ t, n: Number((await all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))[0]?.n ?? 0) }))),
  });
  const { data: versions = [] } = useQuery({ queryKey: ["db-versions"], queryFn: () => all<{ version: string; applied_at: string }>("SELECT * FROM schema_migrations ORDER BY version") });
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTyped, setResetTyped] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);
  const legacyRef = useRef<HTMLInputElement>(null);

  async function backup() {
    const bytes = await (await getDb()).exportBytes();
    downloadFile(`socialai-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.sqlite`, bytes as BlobPart, "application/x-sqlite3");
    await repo.logActivity("db.backup", `Downloaded a database backup (${Math.round(bytes.length / 1024)} KB)`, { level: "success" });
    refresh();
  }

  async function restore(file: File) {
    try {
      await (await getDb()).restoreBytes(new Uint8Array(await file.arrayBuffer()));
      await repo.logActivity("db.restore", `Restored database from ${file.name}`, { level: "warning" });
      toast.success("Backup restored");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function importLegacy(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.event_calendars)) throw new Error("This doesn't look like the cloud export file.");
      const r = await repo.importLegacy(data);
      toast.success(`Imported ${r.calendars} calendar(s), ${r.events} event(s), ${r.providers} provider(s)`, { description: "Imported events start as “Needs review”. Provider keys were not exported — add them again." });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Database & Backup" subtitle={env?.location} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="text-lg font-semibold">Backup & restore</h2>
          <p className="text-sm text-muted-foreground">A backup is one .sqlite file with everything except API keys.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={backup}><Download /> Download backup</Button>
            <Button variant="outline" onClick={() => restoreRef.current?.click()}><Upload /> Restore from file</Button>
            <input ref={restoreRef} type="file" accept=".sqlite,.db" className="hidden" aria-label="Backup file" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending(f); e.target.value = ""; }} />
          </div>
        </section>
        <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="text-lg font-semibold">Health check</h2>
          <p className="text-sm text-muted-foreground">Schema {versions.at(-1)?.version ?? "?"} (app expects {LATEST_SCHEMA}).</p>
          <Button variant="outline" onClick={async () => { const r = await (await getDb()).integrity(); setIntegrity(r); await repo.logActivity("db.integrity", `Integrity check: ${r}`, { level: r === "ok" ? "success" : "error" }); }}><ShieldCheck /> Run integrity check</Button>
          {integrity && <p className={integrity === "ok" ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"} data-testid="integrity-result">Result: {integrity}</p>}
        </section>
        <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="text-lg font-semibold">Import old cloud data</h2>
          <p className="text-sm text-muted-foreground">Load the export file of your earlier online calendars (cloud-export.json).</p>
          <Button variant="outline" onClick={() => legacyRef.current?.click()}><FileJson /> Choose export file</Button>
          <input ref={legacyRef} type="file" accept=".json" className="hidden" aria-label="Cloud export file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importLegacy(f); e.target.value = ""; }} />
        </section>
        <section className="space-y-3 rounded-2xl border border-destructive/40 bg-card p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-destructive">Reset everything</h2>
          <p className="text-sm text-muted-foreground">Deletes calendars, events, schedules, posts, campaigns, accounts, media records, AI providers, comments and settings. API keys are cleared. Schema stays. Download a backup first.</p>
          <Button variant="destructive" onClick={() => { setResetTyped(""); setResetOpen(true); }}><Trash2 /> Reset all data</Button>
        </section>
        <section className="rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="mb-3 text-lg font-semibold">Records</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {counts.map((c) => (<div key={c.t} className="flex justify-between"><dt className="text-muted-foreground">{c.t}</dt><dd className="font-semibold tabular-nums">{c.n}</dd></div>))}
          </dl>
        </section>
      </div>
      <AlertDialog open={resetOpen} onOpenChange={(o) => !o && setResetOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone except by restoring a backup. Type <strong>RESET</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={resetTyped} onChange={(e) => setResetTyped(e.target.value)} placeholder="RESET" aria-label="Type RESET to confirm" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetTyped !== "RESET"}
              onClick={async () => {
                const providers = await repo.listProviders();
                for (const p of providers) await saveKey(p.id, "");
                await repo.factoryResetAllData();
                setResetOpen(false);
                toast.success("All local data reset");
                refresh();
              }}
            >
              Reset all data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all current data with “{pending?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The file is checked first. {env?.mode === "python" ? "A safety copy of the current database is saved in data/backups." : "Download a backup of the current data first if you might need it."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const f = pending; setPending(null); if (f) void restore(f); }}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
