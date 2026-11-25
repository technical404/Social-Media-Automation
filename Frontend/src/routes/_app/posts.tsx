import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ALL_CLIENTS } from "@/lib/client-view";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/posts")({
  head: () => ({ meta: [{ title: "Posts — SocialAI Studio" }] }),
  component: PostsPage,
});

export function PostsPage() {
  const qc = useQueryClient();
  const { data: posts = [] } = useQuery({ queryKey: ["posts"], queryFn: () => repo.listPosts() });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [body, setBody] = useState("");
  const [platform, setPlatform] = useState("");
  const selectedClient = clients.find((c) => c.id === clientFilter) ?? null;
  const visiblePosts = selectedClient ? posts.filter((p) => p.client_id === selectedClient.id) : posts;
  const refresh = () => qc.invalidateQueries({ queryKey: ["posts"] });
  const create = async (status: repo.PostRow["status"] extends never ? string : string) => {
    if (!body.trim()) return toast.error("Write the post first.");
    if (!selectedClient && clients.length) {
      return toast.error("Choose a client first so the post appears in the right client view.");
    }
    await repo.savePost({ body, platform, status, client_id: selectedClient?.id ?? null });
    setBody("");
    toast.success(`Saved as ${status}${selectedClient ? ` for ${selectedClient.name}` : ""}`);
    refresh();
  };
  const setStatus = async (p: repo.PostRow, status: string) => {
    await repo.savePost({ ...p, status });
    refresh();
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Posts & approvals"
        subtitle="Draft → pending → approved → scheduled. Publishing needs official OAuth."
        actions={
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-52" aria-label="Client view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLIENTS}>All clients</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {selectedClient && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border bg-card px-4 py-3 text-sm">
          <p>
            Showing <strong>{selectedClient.name}</strong> · {visiblePosts.length} post{visiblePosts.length === 1 ? "" : "s"}
          </p>
          <span className="text-muted-foreground">New posts are saved to this client.</span>
        </div>
      )}
      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Post body" />
        <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform (e.g. LinkedIn)" className="max-w-xs" />
        {!selectedClient && clients.length > 0 && (
          <p className="text-xs text-muted-foreground">Choose a client above to assign new posts to that client.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => create("draft")}>Save draft</Button>
          <Button variant="outline" onClick={() => create("pending_approval")}>Submit for approval</Button>
        </div>
      </section>
      <ul className="space-y-3">
        {visiblePosts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {selectedClient ? `No posts for ${selectedClient.name} yet.` : "No posts yet."}
          </p>
        )}
        {visiblePosts.map((p) => {
          const tags = (() => {
            try {
              const v = JSON.parse(p.hashtags ?? "[]") as unknown;
              return Array.isArray(v) ? v.join(" ") : "";
            } catch {
              return "";
            }
          })();
          const clientName = clients.find((c) => c.id === p.client_id)?.name;
          return (
            <li key={p.id} className="rounded-2xl border bg-card p-4 shadow-soft">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {p.status} · {p.platform || "no platform"}
                {clientName ? ` · ${clientName}` : ""}
                {p.scheduled_at ? ` · ${p.scheduled_at.slice(0, 10)}` : ""}
              </p>
              {p.topic && (
                <p className="mt-2 text-sm font-semibold">
                  {p.topic}
                  {p.pillar ? <span className="font-normal text-muted-foreground"> · {p.pillar}</span> : null}
                  {p.content_format ? <span className="font-normal text-muted-foreground"> · {p.content_format}</span> : null}
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm">{p.body}</p>
              {tags && <p className="mt-2 text-xs text-muted-foreground">{tags}</p>}
              {p.fail_reason && <p className="mt-2 text-sm text-destructive">{p.fail_reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {p.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => setStatus(p, "pending_approval")}>Submit for approval</Button>
                )}
                {p.status === "pending_approval" && (
                  <>
                    <Button size="sm" onClick={() => setStatus(p, "approved")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => setStatus(p, "rejected")}>Reject</Button>
                  </>
                )}
                {p.status === "approved" && (
                  <Button size="sm" onClick={() => setStatus(p, "scheduled")}>Mark scheduled</Button>
                )}
                {p.status === "rejected" && <p className="text-xs text-muted-foreground">Rejected posts cannot be published automatically.</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
