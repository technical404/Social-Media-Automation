import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — SocialAI Studio" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { data: stats } = useQuery({ queryKey: ["dash"], queryFn: repo.dashboardStats });
  const { data: posts = [] } = useQuery({ queryKey: ["posts"], queryFn: () => repo.listPosts() });
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Only local publishing stats. Platform engagement is not invented." />
      <p className="rounded-xl border p-3 text-sm text-muted-foreground">
        Reach, impressions and engagement from Instagram/LinkedIn/etc. are unavailable until official analytics APIs are connected. Below are counts from this PC&apos;s database.
      </p>
      {stats && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="rounded-2xl border bg-card p-4">
              <dt className="text-xs uppercase text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm">Local posts: {posts.length} (published: {posts.filter((p) => p.status === "published").length}, failed: {posts.filter((p) => p.status === "failed").length})</p>
    </div>
  );
}
