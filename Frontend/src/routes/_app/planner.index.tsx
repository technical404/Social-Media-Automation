import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EventFormDialog } from "@/components/event-form-dialog";
import { CategoryChip, StatusBadge } from "@/components/status-badge";
import { formatMDY, formatTime12 } from "@/lib/dates";
import { SCOPES, SCOPE_LABEL } from "@/lib/global-calendar";
import { todayIn, useAppSettings, useRefresh } from "@/lib/hooks";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/planner/")({
  head: () => ({
    meta: [
      { title: "Global Calendar — SocialAI Studio" },
      { name: "description", content: "The single master calendar of observances. Every client calendar follows it." },
      { property: "og:title", content: "Global Calendar — SocialAI Studio" },
      { property: "og:description", content: "One master calendar of events that every client follows." },
    ],
  }),
  component: PlannerIndex,
});

function PlannerIndex() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const { timezone } = useAppSettings();
  const today = todayIn(timezone);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<repo.EventRow | null>(null);
  const { data: gcal, isLoading } = useQuery({ queryKey: ["global-calendar"], queryFn: repo.ensureGlobalCalendar });
  const { data: events = [] } = useQuery({ queryKey: ["global-events"], queryFn: repo.listGlobalEvents, enabled: !!gcal });

  const upcoming = events.filter((e) => e.start_date >= today).slice(0, 8);
  const byScope = SCOPES.map((s) => ({ s, n: events.filter((e) => e.scope === s).length })).filter((x) => x.n > 0);

  async function loadBuiltins() {
    setBusy(true);
    try {
      const added = await repo.seedGlobalObservances();
      qc.invalidateQueries({ queryKey: ["global-events"] });
      qc.invalidateQueries({ queryKey: ["global-calendar"] });
      toast.success(added ? `Added ${added} built-in observance(s)` : "Built-in observances are already up to date");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !gcal) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Global Calendar"
        subtitle="The one master calendar. Every client calendar follows it — names and dates live here once, clients only choose their own times and schedule."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadBuiltins} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Add built-in observances
            </Button>
            <Button
              variant="highlight"
              onClick={() => navigate({ to: "/planner/$calendarId", params: { calendarId: gcal.id }, search: { generate: true } })}
            >
              <Plus /> Ask AI for events
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Link
          to="/planner/$calendarId"
          params={{ calendarId: gcal.id }}
          className="rounded-2xl border bg-card p-5 shadow-soft transition-colors hover:border-primary/40 lg:col-span-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold"><CalendarDays className="h-5 w-5 text-highlight" /> {gcal.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{events.length} event{events.length === 1 ? "" : "s"} · default {formatTime12(gcal.default_time)} · {gcal.timezone}</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Master</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {byScope.map(({ s, n }) => (
              <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                {SCOPE_LABEL[s] ?? s}: <span className="tabular-nums">{n}</span>
              </span>
            ))}
            {!byScope.length && <span className="text-sm text-muted-foreground">No events yet — add built-in observances or ask the AI.</span>}
          </div>
        </Link>

        <section aria-label="What's coming up" className="rounded-2xl border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Coming up</h2>
            <Link to="/planner/$calendarId" params={{ calendarId: gcal.id }} className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary hover:underline">
              All events
            </Link>
          </div>
          <ul className="mt-3 space-y-3">
            {upcoming.length === 0 && <li className="text-sm text-muted-foreground">Nothing scheduled ahead yet.</li>}
            {upcoming.map((e) => (
              <li key={e.id} className="border-b pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums">{formatMDY(e.start_date)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label={`Edit ${e.name}`}
                    title="Edit this event"
                    onClick={() => setEditing(e)}
                  >
                    <Pencil />
                  </Button>
                </div>
                <p className="mt-0.5 text-sm font-medium leading-snug">{e.name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                  <CategoryChip category={e.category} />
                  <StatusBadge status={e.approval_status} />
                  <span className="text-[11px] text-muted-foreground">{SCOPE_LABEL[e.scope ?? "GLOBAL"] ?? e.scope}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <EventFormDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        calendarId={gcal.id}
        event={editing}
        defaultDate={today}
        onSaved={refresh}
      />
    </div>
  );
}
