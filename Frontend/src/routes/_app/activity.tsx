import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { all } from "@/lib/db";
import * as repo from "@/lib/repo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({
    meta: [
      { title: "Activity Logs — SocialAI Studio" },
      { name: "description", content: "Every change and AI call recorded in your local database." },
      { property: "og:title", content: "Activity Logs — SocialAI Studio" },
      { property: "og:description", content: "Audit trail of changes and AI calls." },
    ],
  }),
  component: ActivityPage,
});

const LEVEL: Record<string, string> = { success: "bg-success", warning: "bg-warning", error: "bg-destructive", info: "bg-primary" };

function ActivityPage() {
  const [level, setLevel] = useState("all");
  const { data = [] } = useQuery({ queryKey: ["activity", "all"], queryFn: () => repo.listActivity(500) });
  const { data: ai = [] } = useQuery({
    queryKey: ["ai-logs"],
    queryFn: () => all<{ id: string; provider_name: string; task: string; model: string; ok: number; latency_ms: number; error: string | null; created_at: string }>("SELECT * FROM ai_request_logs ORDER BY created_at DESC LIMIT 50"),
  });
  const rows = data.filter((r) => level === "all" || r.level === level);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Logs"
        subtitle="A permanent record of what changed and when."
        actions={
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-40" aria-label="Filter level"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {rows.length === 0 ? <EmptyState icon={History} title="No activity yet" body="Changes you make show up here." /> : (
        <ul className="divide-y rounded-2xl border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL[r.level] ?? "bg-muted")} />
              <div className="min-w-0 flex-1"><p>{r.summary}</p><p className="text-xs text-muted-foreground">{r.action}</p></div>
              <time className="shrink-0 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
      <section>
        <h2 className="mb-3 text-xl font-semibold">AI requests</h2>
        {ai.length === 0 ? <p className="text-sm text-muted-foreground">No AI calls yet.</p> : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">When</th><th className="p-2">Provider</th><th className="p-2">Task</th><th className="p-2">Result</th><th className="p-2">Time</th></tr></thead>
              <tbody>
                {ai.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2">{r.provider_name} <span className="text-xs text-muted-foreground">{r.model}</span></td>
                    <td className="p-2">{r.task}</td>
                    <td className={cn("p-2", r.ok ? "text-success" : "text-destructive")}>{r.ok ? "OK" : r.error}</td>
                    <td className="p-2 tabular-nums">{(r.latency_ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
