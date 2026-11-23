import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/post-calendar")({
  head: () => ({ meta: [{ title: "Social post calendar — SocialAI Studio" }] }),
  component: PostCal,
});

function PostCal() {
  const { data: posts = [] } = useQuery({ queryKey: ["posts"], queryFn: () => repo.listPosts() });
  const scheduled = posts.filter((p) => p.scheduled_at || p.status === "scheduled");
  return (
    <div className="space-y-6">
      <PageHeader title="Social post calendar" subtitle="Independent of the Event Calendar. Times are stored in SQLite." />
      <ul className="space-y-2">
        {scheduled.length === 0 && <p className="text-sm text-muted-foreground">No scheduled posts. Approve a draft then mark it scheduled.</p>}
        {scheduled.map((p) => (
          <li key={p.id} className="rounded-2xl border bg-card p-4 text-sm">
            <p className="font-semibold tabular-nums">{p.scheduled_at ?? "no time"} · {p.platform || "—"} · {p.status}</p>
            <p className="mt-1 whitespace-pre-wrap">{p.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
