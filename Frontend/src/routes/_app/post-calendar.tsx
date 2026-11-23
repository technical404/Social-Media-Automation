import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/post-calendar")({
  head: () => ({ meta: [{ title: "Social post calendar — SocialAI Studio" }] }),
  component: PostCal,
});

function PostCal() {
  const { data: posts = [] } = useQuery({ queryKey: ["posts"], queryFn: () => repo.listPosts() });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const [clientFilter, setClientFilter] = useState("all");
  const scheduled = posts.filter((p) => p.scheduled_at || p.status === "scheduled");
  const visible = scheduled.filter((p) => clientFilter === "all" || p.client_id === clientFilter);

  const groups = new Map<string, repo.PostRow[]>();
  for (const p of visible) {
    const key = p.topic.trim() || "General posts";
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const grouped = [...groups.entries()]
    .map(([topic, rows]) => ({
      topic,
      rows: [...rows].sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")),
    }))
    .sort((a, b) => (a.rows[0]?.scheduled_at ?? "").localeCompare(b.rows[0]?.scheduled_at ?? ""));

  return (
    <div className="space-y-6">
      <PageHeader title="Social post calendar" subtitle="Independent of the Event Calendar. Topic plans and drafts are grouped by topic." />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Client</span>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-56" aria-label="Filter by client"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No scheduled posts{clientFilter === "all" ? "" : " for this client"}. Approve a draft, or approve an AI topic plan.
        </p>
      )}
      {grouped.map((g) => (
        <section key={g.topic} className="space-y-2" aria-label={`Topic ${g.topic}`}>
          <h2 className="text-lg font-semibold">
            {g.topic}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{g.rows.length} post{g.rows.length === 1 ? "" : "s"}</span>
          </h2>
          <ul className="space-y-2">
            {g.rows.map((p) => {
              const clientName = clients.find((c) => c.id === p.client_id)?.name;
              return (
                <li key={p.id} className="rounded-2xl border bg-card p-4 text-sm">
                  <p className="font-semibold tabular-nums">
                    {p.scheduled_at ? `${p.scheduled_at.slice(0, 10)} ${p.scheduled_at.slice(11, 16)}` : "no time"} · {p.platform || "—"} · {p.status}
                    {clientName ? ` · ${clientName}` : ""}
                  </p>
                  {p.pillar && <p className="mt-1 text-xs text-muted-foreground">{p.pillar}{p.content_format ? ` · ${p.content_format}` : ""}</p>}
                  <p className="mt-1 whitespace-pre-wrap">{p.body}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
