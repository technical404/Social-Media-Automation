import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/posts")({
  head: () => ({ meta: [{ title: "Posts — SocialAI Studio" }] }),
  component: PostsPage,
});

function PostsPage() {
  const qc = useQueryClient();
  const { data: posts = [] } = useQuery({ queryKey: ["posts"], queryFn: () => repo.listPosts() });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const [body, setBody] = useState("");
  const [platform, setPlatform] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["posts"] });
  const create = async (status: repo.PostRow["status"] extends never ? string : string) => {
    if (!body.trim()) return toast.error("Write the post first.");
    await repo.savePost({ body, platform, status });
    setBody("");
    toast.success(`Saved as ${status}`);
    refresh();
  };
  const setStatus = async (p: repo.PostRow, status: string) => {
    await repo.savePost({ ...p, status });
    refresh();
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Posts & approvals" subtitle="Draft → pending → approved → scheduled. Publishing needs official OAuth." />
      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Post body" />
        <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform (e.g. LinkedIn)" className="max-w-xs" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => create("draft")}>Save draft</Button>
          <Button variant="outline" onClick={() => create("pending_approval")}>Submit for approval</Button>
        </div>
      </section>
      <ul className="space-y-3">
        {posts.length === 0 && <p className="text-sm text-muted-foreground">No posts yet.</p>}
        {posts.map((p) => {
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
