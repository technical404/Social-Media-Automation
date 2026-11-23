import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CalendarCheck, CalendarClock, CalendarDays, CheckCircle2, Cpu, Plus, Send, Server, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { CategoryChip, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { envQuery } from "@/lib/hooks";
import { formatMDY, formatTime12 } from "@/lib/dates";
import { effectiveTime } from "@/lib/planner";
import * as repo from "@/lib/repo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SocialAI Studio" },
      { name: "description", content: "Live counts of events, approvals, schedules and AI provider health from your local database." },
      { property: "og:title", content: "Dashboard — SocialAI Studio" },
      { property: "og:description", content: "Live counts of events, approvals, schedules and AI provider health." },
    ],
  }),
  component: Dashboard,
});

function Stat({ icon: Icon, label, value, tone, to }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; tone?: string; to?: string }) {
  const body = (
    <div className="rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className={cn("h-4 w-4", tone)} /> {label}</div>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums" data-testid={`stat-${label}`}>{value}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Dashboard() {
  const { data: s } = useQuery({ queryKey: ["stats"], queryFn: repo.dashboardStats });
  const { data: upcoming = [] } = useQuery({ queryKey: ["upcoming"], queryFn: () => repo.upcomingEvents(8) });
  const { data: activity = [] } = useQuery({ queryKey: ["activity", "dash"], queryFn: () => repo.listActivity(8) });
  const { data: env } = useQuery(envQuery);
  const hb = env?.health?.worker.heartbeat_at;
  const workerOk = !!hb && Date.now() - new Date(hb).getTime() < 60000;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Everything here is counted from your local database."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/planner" search={{ new: true }}><Plus /> New calendar</Link></Button>
            <Button asChild variant="highlight"><Link to="/planner" search={{ new: true, ai: true }}><Wand2 /> Generate events</Link></Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={CalendarDays} label="Events" value={s?.events ?? "–"} to="/calendar" />
        <Stat icon={CalendarClock} label="Next 30 days" value={s?.upcoming30 ?? "–"} />
        <Stat icon={AlertTriangle} label="Needs review" value={s?.pending ?? "–"} tone="text-warning" />
        <Stat icon={CheckCircle2} label="Approved" value={s?.approved ?? "–"} tone="text-success" />
        <Stat icon={CalendarCheck} label="Scheduled" value={s?.scheduled ?? "–"} tone="text-highlight" />
        <Stat icon={Send} label="Published" value={s?.published ?? "–"} />
        <Stat icon={AlertTriangle} label="Failed" value={s?.failed ?? "–"} tone="text-destructive" />
        <Stat icon={Cpu} label="AI providers OK" value={s ? `${s.providersHealthy}/${s.providers}` : "–"} to="/providers" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border bg-card p-5 shadow-soft lg:col-span-2">
          <h2 className="mb-3 text-xl font-semibold">Upcoming timeline</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events. <Link to="/planner" search={{ new: true, ai: true }} className="font-semibold text-primary hover:underline">Generate a calendar</Link>.</p>
          ) : (
            <ol className="space-y-2">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <Link to="/planner/$calendarId" params={{ calendarId: e.calendar_id }} search={{ date: e.start_date }} className="flex flex-wrap items-center gap-3 rounded-xl border p-3 hover:bg-muted/50">
                    <span className="w-28 text-base font-extrabold tabular-nums">{formatMDY(e.start_date)}</span>
                    <span className="text-xs text-muted-foreground">{formatTime12(effectiveTime(e, { default_time: e.default_time ?? "10:00" }))}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                    <CategoryChip category={e.category} />
                    <StatusBadge status={e.approval_status} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><Server className="h-5 w-5" /> System health</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Data stored</dt><dd className="text-right font-medium">{env ? (env.mode === "python" ? "On this PC (SQLite file)" : "In this browser (SQLite)") : "…"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Scheduler worker</dt><dd className={cn("font-medium", workerOk ? "text-success" : "text-muted-foreground")}>{env?.mode === "python" ? (workerOk ? "Running" : "Not responding") : "Only with python main.py"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">AI calls (7 days)</dt><dd className="font-medium">{s ? `${s.aiCalls7d} · ${s.aiFail7d} failed` : "…"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Calendars</dt><dd className="font-medium">{s?.calendars ?? "…"}</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-soft">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><Activity className="h-5 w-5" /> Recent activity</h2>
            {activity.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">
                {activity.map((a) => (
                  <li key={a.id}><p className="leading-snug">{a.summary}</p><p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
