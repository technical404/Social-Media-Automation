import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, CalendarDays, Clock, Download, LayoutGrid, MousePointerClick, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ThreeMonthCalendar, type DayItem } from "@/components/three-month-calendar";
import { EventFormDialog } from "@/components/event-form-dialog";
import { CategoryChip, StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/app-shell";
import { TIMEZONES, formatMDY, formatTime12, initialScheduleDate } from "@/lib/dates";
import { CATEGORIES, effectiveTime, filterAndSort, toCSV, type ListFilters } from "@/lib/planner";
import { PLATFORM_LABEL } from "@/lib/platforms";
import { downloadFile, todayIn, useAppSettings, useRefresh } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import * as repo from "@/lib/repo";

type Confirm = { title: string; body: string; label: string; action: () => Promise<void> } | null;

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

function exportRows(events: repo.EventRow[]) {
  return events.map((e) => ({
    date: formatMDY(e.start_date),
    end_date: formatMDY(e.end_date),
    time: effectiveTime(e, { default_time: e.default_time ?? "10:00" }),
    timezone: e.timezone ?? "",
    name: e.name,
    short_description: e.short_description,
    category: e.category,
    type: e.event_kind,
    source_url: e.source_url,
    approval: e.approval_status,
    publishing: e.publish_status,
    platforms: parseList(e.platforms).join(" "),
    calendar: e.calendar_name ?? "",
  }));
}

export function EventWorkspace({
  calendar,
  events,
  focusDate,
  globalCalendarId,
}: {
  calendar: repo.Calendar | null;
  events: repo.EventRow[];
  focusDate?: string | undefined;
  /** For a client calendar: where custom events are stored (the single Global Calendar). */
  globalCalendarId?: string | undefined;
}) {
  const refresh = useRefresh();
  const { timezone: appTz } = useAppSettings();
  const tz = calendar?.timezone ?? appTz;
  const today = todayIn(tz);
  // A client calendar references the Global Calendar: names/dates are shared, only times and
  // status are this client's own.
  const reference = !!(calendar && !calendar.is_global && calendar.client_id);
  const writeCal = calendar?.id ?? null;
  const createTarget = reference ? globalCalendarId ?? null : calendar?.id ?? null;

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [start, setStart] = useState<Date>(() => {
    const iso = initialScheduleDate(today, events.map((e) => e.start_date), focusDate);
    return new Date(`${iso}T00:00:00`);
  });
  // When the first events arrive (e.g. right after approving an AI proposal), jump to them.
  const hadEvents = useRef(events.length > 0);
  useEffect(() => {
    if (hadEvents.current || !events.length) return;
    hadEvents.current = true;
    const iso = initialScheduleDate(today, events.map((e) => e.start_date));
    setStart(new Date(`${iso}T00:00:00`));
  }, [events, today]);
  const [selectMode, setSelectMode] = useState(false);
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [dayOpen, setDayOpen] = useState<string | null>(focusDate ?? null);
  const [globalTime, setGlobalTime] = useState(calendar?.default_time ?? "10:00");
  const [resetOverrides, setResetOverrides] = useState(false);
  const [selTime, setSelTime] = useState(calendar?.default_time ?? "10:00");
  const [bulkTime, setBulkTime] = useState(calendar?.default_time ?? "10:00");
  const [editing, setEditing] = useState<repo.EventRow | "new" | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [filters, setFilters] = useState<ListFilters>({ q: "", category: "all", status: "all", from: "", to: "", sort: "date_asc" });

  const byDate = useMemo(() => {
    const m = new Map<string, repo.EventRow[]>();
    for (const e of events) m.set(e.start_date, [...(m.get(e.start_date) ?? []), e]);
    return m;
  }, [events]);
  const dayItems = useMemo(() => {
    const m = new Map<string, DayItem[]>();
    for (const [d, l] of byDate) m.set(d, l.map((e) => ({ name: e.name, category: e.category, approval_status: e.approval_status, publish_status: e.publish_status, time: formatTime12(effectiveTime(e, { default_time: e.default_time ?? "10:00" })) })));
    return m;
  }, [byDate]);

  const overrides = events.filter((e) => e.time_override).length;
  const selectedDateEvents = events.filter((e) => dates.has(e.start_date));
  const listed = filterAndSort(events, filters);
  const selectedEvents = events.filter((e) => ids.has(e.id));

  const toggleDate = (iso: string) => {
    if (!selectMode) return setDayOpen(iso);
    setDates((s) => {
      const n = new Set(s);
      if (n.has(iso)) n.delete(iso);
      else n.add(iso);
      return n;
    });
  };
  const toggleId = (id: string) =>
    setIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const ask = (c: NonNullable<Confirm>) => setConfirm(c);
  const doExport = (rows: repo.EventRow[], kind: "csv" | "json") => {
    if (!rows.length) return void toast.info("Nothing to export.");
    const name = `${(calendar?.name ?? "all-events").replace(/\W+/g, "-").toLowerCase()}-${today}`;
    if (kind === "csv") downloadFile(`${name}.csv`, toCSV(exportRows(rows)), "text/csv");
    else downloadFile(`${name}.json`, JSON.stringify(exportRows(rows), null, 2), "application/json");
    void repo.logActivity("export.events", `Exported ${rows.length} event(s) as ${kind.toUpperCase()}`);
  };

  async function scheduleIds(list: string[]) {
    const r = await repo.scheduleEvents(list, writeCal);
    toast.success(`${r.scheduled} event(s) scheduled${r.skipped ? ` · ${r.skipped} skipped (not approved or already scheduled)` : ""}`);
    refresh();
  }

  async function updateOne(e: repo.EventRow, time: string) {
    await repo.setTimeForEvents([e.id], time === e.default_time ? null : time, writeCal);
    toast.success(`${e.name}: ${formatTime12(time)}`);
    refresh();
  }

  const timeCell = (e: repo.EventRow) => (
    <div className="flex items-center gap-1.5">
      <Input
        key={`${e.id}-${e.time_override}-${e.default_time}`}
        type="time"
        aria-label={`Time for ${e.name}`}
        className="h-8 w-[7.5rem] text-xs"
        defaultValue={effectiveTime(e, { default_time: e.default_time ?? "10:00" })}
        onBlur={(ev) => ev.target.value && ev.target.value !== effectiveTime(e, { default_time: e.default_time ?? "10:00" }) && updateOne(e, ev.target.value)}
      />
      <span className="text-[11px] text-muted-foreground">{e.timezone}</span>
      {e.time_override && (
        <button className="text-[11px] font-semibold text-primary hover:underline" onClick={async () => { await repo.setTimeForEvents([e.id], null, writeCal); refresh(); }} title="Use the calendar's default time">
          own time · reset
        </button>
      )}
    </div>
  );

  const tile = (e: repo.EventRow) => {
    const platforms = parseList(e.platforms);
    return (
      <article key={e.id} data-testid="event-tile" className={cn("flex flex-col rounded-2xl border bg-card p-4 shadow-soft", ids.has(e.id) && "border-primary bg-secondary/40")}>
        <div className="flex items-start justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={ids.has(e.id)} onCheckedChange={() => toggleId(e.id)} aria-label={`Select ${e.name}`} />
            <span className="text-xl font-extrabold tabular-nums tracking-tight">{formatMDY(e.start_date)}</span>
          </label>
          <CategoryChip category={e.category} />
        </div>
        {e.end_date !== e.start_date && <p className="text-xs text-muted-foreground">until {formatMDY(e.end_date)}</p>}
        <h3 className="mt-2 font-sans text-base font-semibold leading-snug">{e.name}</h3>
        {e.short_description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{e.short_description}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge status={e.approval_status} />
          <StatusBadge status={e.publish_status} />
          {e.event_kind === "official_observance" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Official{e.verification_status === "verified" ? " · checked" : " · unchecked"}</span>}
          {e.event_code && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title="Stable event code">{e.event_code}</span>}
          {!calendar && e.calendar_name && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{e.calendar_name}</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Platforms: {platforms.length ? platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") : "none chosen yet"}</p>
        <div className="mt-auto flex items-center gap-1 pt-3">
          {timeCell(e)}
          {reference ? (
            <>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From Global Calendar</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${e.name} from this client`} onClick={() => ask({ title: "Remove from this client's calendar?", body: `“${e.name}” stays in the Global Calendar but will be hidden for this client.`, label: "Remove", action: async () => { await repo.deleteEvents([e.id], writeCal); refresh(); } })}><Trash2 /></Button>
            </>
          ) : (
            <>
              <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}><Pencil /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete ${e.name}`} onClick={() => ask({ title: "Delete this event?", body: `“${e.name}” on ${formatMDY(e.start_date)} will be removed.`, label: "Delete", action: async () => { await repo.deleteEvents([e.id], writeCal); refresh(); } })}><Trash2 /></Button>
            </>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5">
      {/* Global scheduling controls — always at the top */}
      <section aria-label="Scheduling controls" className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 self-center text-sm font-semibold"><Clock className="h-4 w-4 text-highlight" /> Posting time</div>
          {calendar && (
            <>
              <div className="space-y-1">
                <Label htmlFor="global-time" className="text-xs text-muted-foreground">Default for the whole calendar</Label>
                <div className="flex gap-2">
                  <Input id="global-time" type="time" className="w-32" value={globalTime} onChange={(e) => setGlobalTime(e.target.value)} />
                  <Button
                    onClick={() =>
                      ask({
                        title: `Use ${formatTime12(globalTime)} for the entire calendar?`,
                        body: overrides
                          ? `${overrides} event(s) have their own time. ${resetOverrides ? "They will be reset to the new default." : "They keep their own time (own times always win)."}`
                          : "Every event in this calendar will use this time.",
                        label: "Apply",
                        action: async () => {
                          await repo.applyDefaultTime(calendar.id, globalTime, resetOverrides);
                          refresh();
                          toast.success(`Default time is now ${formatTime12(globalTime)}`);
                        },
                      })
                    }
                  >
                    Apply to entire calendar
                  </Button>
                </div>
                {overrides > 0 && (
                  <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <Checkbox checked={resetOverrides} onCheckedChange={(v) => setResetOverrides(v === true)} /> also reset {overrides} own time{overrides > 1 ? "s" : ""}
                  </label>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Time zone</Label>
                <Select value={calendar.timezone} onValueChange={async (v) => { await repo.updateCalendar(calendar.id, { timezone: v }); refresh(); }}>
                  <SelectTrigger className="w-48" aria-label="Time zone"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          {view === "calendar" && (
            <label className="flex items-center gap-2 self-center text-sm">
              <Switch checked={selectMode} onCheckedChange={(v) => { setSelectMode(v); if (!v) setDates(new Set()); }} aria-label="Select dates" />
              <MousePointerClick className="h-4 w-4" /> Select dates
            </label>
          )}
          <div className="ml-auto flex items-end gap-2">
            <Button
              variant="success"
              onClick={() => {
                const pool = ids.size ? selectedEvents : dates.size ? selectedDateEvents : events;
                const approved = pool.filter((e) => e.approval_status === "approved" && e.publish_status === "not_scheduled");
                ask({
                  title: `Save schedule for ${approved.length} event(s)?`,
                  body: `${approved.length} approved event(s) get scheduled at their times. ${pool.length - approved.length} are skipped (not approved yet or already scheduled). Test mode: nothing is posted to social media yet.`,
                  label: "Save schedule",
                  action: () => scheduleIds(pool.map((e) => e.id)),
                });
              }}
              disabled={!events.length}
            >
              <CalendarCheck /> Save schedule
            </Button>
            {calendar && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    ask({
                      title: "Undo last schedule change?",
                      body: "Default time, timezone, per-date times and scheduled flags go back to the previous snapshot for this calendar.",
                      label: "Undo last",
                      action: async () => {
                        const ok = await repo.undoLastSchedule(calendar.id);
                        if (!ok) toast.error("Nothing to undo yet. Change a time or save a schedule first.");
                        else toast.success("Last schedule change undone");
                        refresh();
                      },
                    })
                  }
                >
                  <Undo2 /> Undo last
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    ask({
                      title: "Reset all times on this calendar?",
                      body: "Default posting time becomes 10:00. Every own-time override is cleared. Scheduled events become not scheduled. Events themselves stay.",
                      label: "Reset times",
                      action: async () => {
                        await repo.snapshotSchedule(calendar.id);
                        await repo.applyDefaultTime(calendar.id, "10:00", true);
                        await repo.unscheduleEvents(events.map((e) => e.id), writeCal);
                        setGlobalTime("10:00");
                        toast.success("Calendar times reset to 10:00");
                        refresh();
                      },
                    })
                  }
                >
                  <RotateCcw /> Reset times
                </Button>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Show As</Label>
              <Select value={view} onValueChange={(v) => setView(v as "calendar" | "list")}>
                <SelectTrigger className="w-40" aria-label="Show As"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calendar"><span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Calendar View</span></SelectItem>
                  <SelectItem value="list"><span className="inline-flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> List View</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {view === "calendar" && dates.size > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-accent p-3 text-accent-foreground" data-testid="date-selection-bar">
            <span className="text-sm font-semibold">{dates.size} date{dates.size > 1 ? "s" : ""} selected · {selectedDateEvents.length} event{selectedDateEvents.length === 1 ? "" : "s"}</span>
            <Input aria-label="Time for selected dates" type="time" className="w-32 bg-card" value={selTime} onChange={(e) => setSelTime(e.target.value)} />
            <Button size="sm" disabled={!selectedDateEvents.length} onClick={async () => { await repo.setTimeForEvents(selectedDateEvents.map((e) => e.id), selTime, writeCal); toast.success(`${selectedDateEvents.length} event(s) on ${dates.size} date(s) set to ${formatTime12(selTime)}`); refresh(); }}>
              Apply to selected dates
            </Button>
            <Button size="sm" variant="outline" className="bg-card" disabled={!selectedDateEvents.length} onClick={async () => { await repo.setTimeForEvents(selectedDateEvents.map((e) => e.id), null, writeCal); toast.success("Back to the default time"); refresh(); }}>
              <RotateCcw /> Use default time
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDates(new Set())}><X /> Clear selected dates</Button>
          </div>
        )}
        {view === "calendar" && dates.size === 0 && events.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {selectMode ? "Click dates to select them, then give them their own time." : "Click a date to see its events. Turn on “Select dates” to pick several dates and change their time together."}
          </p>
        )}
      </section>

      {events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" body={calendar ? "Ask the AI for suggestions or add your own event." : "Create a calendar in Event Planner first."} action={calendar ? <Button variant="outline" onClick={() => setEditing("new")}><Plus /> Add event</Button> : undefined} />
      ) : view === "calendar" ? (
        <>
          <ThreeMonthCalendar start={start} onShift={(n) => setStart((d) => new Date(d.getFullYear(), d.getMonth() + n, 1))} items={dayItems} selected={dates} onDayClick={toggleDate} today={today} />
          {dates.size > 0 && (
            <section aria-label="Events on selected dates">
              <h2 className="mb-3 text-xl font-semibold">Events on selected dates</h2>
              {selectedDateEvents.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{selectedDateEvents.map(tile)}</div>
              ) : (
                <p className="text-sm text-muted-foreground">No events on these dates yet.</p>
              )}
            </section>
          )}
        </>
      ) : (
        <section aria-label="Event list" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-3">
            <div className="min-w-48 flex-1 space-y-1">
              <Label htmlFor="f-q" className="text-xs text-muted-foreground">Search</Label>
              <Input id="f-q" placeholder="Event name or description" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={filters.category} onValueChange={(v) => setFilters({ ...filters, category: v })}>
                <SelectTrigger className="w-40" aria-label="Category filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger className="w-40" aria-label="Status filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending_review">Needs review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="not_scheduled">Not scheduled</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="f-from" type="date" className="w-40" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="f-to" type="date" className="w-40" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort</Label>
              <Select value={filters.sort} onValueChange={(v) => setFilters({ ...filters, sort: v as ListFilters["sort"] })}>
                <SelectTrigger className="w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_asc">Date (earliest)</SelectItem>
                  <SelectItem value="date_desc">Date (latest)</SelectItem>
                  <SelectItem value="name_asc">Name (A–Z)</SelectItem>
                  <SelectItem value="name_desc">Name (Z–A)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><Download /> Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{listed.length} shown</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => doExport(listed, "csv")}>Shown events as CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => doExport(listed, "json")}>Shown events as JSON</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!ids.size} onSelect={() => doExport(selectedEvents, "csv")}>Selected ({ids.size}) as CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={listed.length > 0 && listed.every((e) => ids.has(e.id))} onCheckedChange={(v) => setIds(v ? new Set(listed.map((e) => e.id)) : new Set())} aria-label="Select all shown" />
              Select all ({listed.length})
            </label>
            {ids.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-accent px-3 py-2 text-accent-foreground" data-testid="bulk-bar">
                <span className="text-sm font-semibold">{ids.size} selected</span>
                <Input aria-label="Time for selected events" type="time" className="h-8 w-28 bg-card" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} />
                <Button size="sm" onClick={async () => { await repo.setTimeForEvents([...ids], bulkTime, writeCal); toast.success(`${ids.size} event(s) set to ${formatTime12(bulkTime)}`); refresh(); }}>Change time</Button>
                <Select onValueChange={(v) => ask({ title: `Change ${ids.size} event(s) to “${v}”?`, body: "Changed events go back to “Needs review”.", label: "Change", action: async () => { await repo.setCategoryForEvents([...ids], v, writeCal); refresh(); } })}>
                  <SelectTrigger className="h-8 w-40 bg-card" aria-label="Change category"><SelectValue placeholder="Change category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="success" onClick={() => ask({ title: `Approve ${ids.size} event(s)?`, body: "Approved events can then be scheduled.", label: "Approve", action: async () => { await repo.approveEvents([...ids], writeCal); refresh(); } })}>Approve</Button>
                <Button size="sm" variant="outline" className="bg-card" onClick={() => scheduleIds([...ids])}>Schedule</Button>
                <Button size="sm" variant="outline" className="bg-card" onClick={async () => { await repo.unscheduleEvents([...ids], writeCal); refresh(); }}>Unschedule</Button>
                <Button size="sm" variant="destructive" onClick={() => ask({ title: reference ? `Remove ${ids.size} event(s) from this client?` : `Delete ${ids.size} event(s)?`, body: reference ? "They stay in the Global Calendar but will be hidden for this client." : "This cannot be undone (make a backup first if unsure).", label: reference ? "Remove" : "Delete", action: async () => { await repo.deleteEvents([...ids], writeCal); setIds(new Set()); refresh(); } })}>{reference ? "Remove" : "Delete"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setIds(new Set())}><X /> Clear</Button>
              </div>
            )}
          </div>
          {listed.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{listed.map(tile)}</div> : <p className="text-sm text-muted-foreground">No events match these filters.</p>}
        </section>
      )}

      <Sheet open={!!dayOpen} onOpenChange={(o) => !o && setDayOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-2xl font-extrabold tabular-nums">{dayOpen && formatMDY(dayOpen)}</SheetTitle>
            <SheetDescription>{(dayOpen && byDate.get(dayOpen)?.length) || 0} event(s) · times in {tz}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {(dayOpen ? byDate.get(dayOpen) ?? [] : []).map((e) => (
              <div key={e.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-sans font-semibold">{e.name}</h3>
                  <CategoryChip category={e.category} />
                </div>
                {e.short_description && <p className="mt-1 text-sm text-muted-foreground">{e.short_description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={e.approval_status} /><StatusBadge status={e.publish_status} /></div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {timeCell(e)}
                  {e.approval_status !== "approved" && <Button size="sm" variant="success" onClick={async () => { await repo.approveEvents([e.id], writeCal); refresh(); }}>Approve</Button>}
                  {!reference && <Button size="sm" variant="outline" onClick={() => setEditing(e)}><Pencil /> Edit</Button>}
                </div>
              </div>
            ))}
            {calendar && dayOpen && (
              <Button variant="outline" className="w-full" onClick={() => setEditing("new")}><Plus /> Add event on {formatMDY(dayOpen)}</Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {(createTarget || (editing && editing !== "new")) && (
        <EventFormDialog
          open={editing !== null}
          onOpenChange={(v) => !v && setEditing(null)}
          calendarId={editing && editing !== "new" ? editing.calendar_id : createTarget!}
          event={editing === "new" ? null : editing}
          defaultDate={dayOpen ?? today}
          onSaved={refresh}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                try {
                  await c?.action();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {confirm?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

