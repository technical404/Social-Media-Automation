import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EventFormDialog } from "@/components/event-form-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryChip, StatusBadge } from "@/components/status-badge";
import { formatMDY, formatTime12 } from "@/lib/dates";
import { ALL_CLIENTS, clientThemes, filterEventsForClient } from "@/lib/client-view";
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
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [themeOnly, setThemeOnly] = useState(true);
  const { data: gcal, isLoading } = useQuery({ queryKey: ["global-calendar"], queryFn: repo.ensureGlobalCalendar });
  const { data: events = [] } = useQuery({ queryKey: ["global-events"], queryFn: repo.listGlobalEvents, enabled: !!gcal });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const { data: clientCalendars = [] } = useQuery({
    queryKey: ["client-calendars", clientFilter],
    queryFn: () => repo.listCalendarsByClient(clientFilter),
    enabled: clientFilter !== ALL_CLIENTS,
  });
  const { data: clientEvents = [] } = useQuery({
    queryKey: ["client-visible-events", clientFilter],
    queryFn: () => repo.listClientVisibleEvents(clientFilter),
    enabled: clientFilter !== ALL_CLIENTS,
  });
  const { data: clientHandles = [], isLoading: handlesLoading } = useQuery({
    queryKey: ["client-social-handles", clientFilter],
    queryFn: () => repo.listClientSocialHandles(clientFilter),
    enabled: clientFilter !== ALL_CLIENTS,
  });

  const selectedClient = clients.find((c) => c.id === clientFilter) ?? null;
  const themes = clientThemes(selectedClient, clientCalendars);
  const allowedPlatforms = selectedClient && !handlesLoading ? [...new Set(clientHandles.map((h) => h.platform))] : undefined;
  const visibleEvents = selectedClient
    ? filterEventsForClient(clientEvents, selectedClient, themes, themeOnly)
    : events;
  const activeCalendarId = selectedClient ? clientCalendars[0]?.id ?? gcal?.id : gcal?.id;
  const upcoming = visibleEvents.filter((e) => e.start_date >= today).slice(0, 8);
  const byScope = SCOPES.map((s) => ({ s, n: visibleEvents.filter((e) => e.scope === s).length })).filter((x) => x.n > 0);

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
        subtitle="The one master calendar. Tag each event with a client category; a client view only shows its own category and scope."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-52" aria-label="Client view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CLIENTS}>All clients (shared master)</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              disabled={!clients.length}
              onValueChange={(clientId) => navigate({ to: "/clients/$clientId", params: { clientId } })}
            >
              <SelectTrigger className="w-52" aria-label="Open a client calendar">
                <SelectValue placeholder={clients.length ? "Open client calendar" : "No clients yet"} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadBuiltins} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Add built-in observances
            </Button>
            <Button
              variant="highlight"
              onClick={() => navigate({
                to: "/planner/$calendarId",
                params: { calendarId: activeCalendarId ?? gcal.id },
                search: { generate: true, client: selectedClient?.id },
              })}
            >
              <Plus /> Ask AI for events
            </Button>
          </div>
        }
      />

      {selectedClient && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3 text-sm">
          <p>
            Showing <strong>{selectedClient.name}</strong> · {SCOPE_LABEL[selectedClient.scope] ?? "Worldwide"} events
            {selectedClient.industry ? <> · category <strong>{selectedClient.industry}</strong></> : null}
            {themes.length ? <> · theme <strong>{themes.join(", ")}</strong></> : null}
          </p>
          {!selectedClient.industry && (
            <span className="text-xs text-muted-foreground">Set the client industry/category to see matching shared events.</span>
          )}
          {themes.length > 0 && (
            <label htmlFor="theme-only" className="flex items-center gap-2 text-muted-foreground">
              <Checkbox id="theme-only" checked={themeOnly} onCheckedChange={(v) => setThemeOnly(v === true)} />
              Only events matching this theme
            </label>
          )}
          {!themes.length && <span className="text-xs text-muted-foreground">Set a theme on the client or one of its calendars to filter the list.</span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Link
          to="/planner/$calendarId"
          params={{ calendarId: activeCalendarId ?? gcal.id }}
          className="rounded-2xl border bg-card p-5 shadow-soft transition-colors hover:border-primary/40 lg:col-span-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold"><CalendarDays className="h-5 w-5 text-highlight" /> {selectedClient ? `${selectedClient.name} calendar` : gcal.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{visibleEvents.length} event{visibleEvents.length === 1 ? "" : "s"} · default {formatTime12(gcal.default_time)} · {gcal.timezone}</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{selectedClient ? "Client view" : "Master"}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {themes.map((theme) => (
              <span key={theme} className="rounded-full bg-highlight/15 px-2.5 py-0.5 text-xs font-medium">{theme}</span>
            ))}
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
            <Link to="/planner/$calendarId" params={{ calendarId: activeCalendarId ?? gcal.id }} className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary hover:underline">
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
        defaultIndustry={selectedClient?.industry}
        allowedPlatforms={allowedPlatforms}
        onSaved={refresh}
      />
    </div>
  );
}
