import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMDY, formatTime12 } from "@/lib/dates";
import { groupPostsByTopic } from "@/lib/post-groups";
import * as repo from "@/lib/repo";

function postHashtags(raw: string): string {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.join(" ") : "";
  } catch {
    return "";
  }
}

/**
 * Draft and scheduled posts for one client. Posts are separate from events, so the
 * event calendar above stays a calendar of events.
 */
export function ClientPosts({ clientId }: { clientId: string }) {
  const { data: posts, isLoading } = useQuery({ queryKey: ["client-posts", clientId], queryFn: () => repo.listClientPosts(clientId) });
  const grouped = groupPostsByTopic(posts ?? []);
  const count = posts?.length ?? 0;

  return (
    <section aria-label="Client content posts" data-testid="client-posts" className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-4 w-4" /> Content posts
            <span className="text-sm font-normal text-muted-foreground">{count} post{count === 1 ? "" : "s"}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Draft and scheduled posts for this client, separate from the event calendar. AI topic plans appear here.</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/posts">Open Posts &amp; Approvals <ArrowRight /></Link></Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading posts…</div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No content posts yet. Open a calendar, choose Ask AI → Social topics, and approve a topic plan.</p>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {grouped.map((group) => (
            <div key={group.topic} className="space-y-2" data-testid="client-post-group">
              <h3 className="text-base font-semibold">
                {group.topic}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{group.rows.length} post{group.rows.length === 1 ? "" : "s"}</span>
              </h3>
              <ul className="space-y-2">
                {group.rows.map((post) => {
                  const tags = postHashtags(post.hashtags);
                  return (
                    <li key={post.id} data-testid="client-post" className="rounded-xl border bg-background p-3 text-sm">
                      <p className="font-semibold tabular-nums">
                        {post.scheduled_at ? `${formatMDY(post.scheduled_at.slice(0, 10))} · ${formatTime12(post.scheduled_at.slice(11, 16))}` : "No date"} · {post.platform || "—"} · {post.status}
                      </p>
                      {post.pillar && <p className="mt-1 text-xs text-muted-foreground">{post.pillar}{post.content_format ? ` · ${post.content_format}` : ""}</p>}
                      <p className="mt-1 whitespace-pre-wrap">{post.body}</p>
                      {tags && <p className="mt-1 text-xs text-muted-foreground">{tags}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
