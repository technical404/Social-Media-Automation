import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app-shell";
import { ClientPosts } from "@/components/client-posts";
import { EventWorkspace } from "@/components/event-workspace";
import { IndustrySelect } from "@/components/industry-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONES } from "@/lib/dates";
import { SCOPES, SCOPE_LABEL } from "@/lib/global-calendar";
import { PLATFORM_LABEL } from "@/lib/platforms";
import { useRefresh } from "@/lib/hooks";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/clients/$clientId")({
  head: () => ({ meta: [{ title: "Client scheduler — SocialAI Studio" }] }),
  component: ClientSchedulerPage,
});

function ClientSchedulerPage() {
  const { clientId } = Route.useParams();
  const refresh = useRefresh();
  const { data: client } = useQuery({ queryKey: ["client", clientId], queryFn: () => repo.getClient(clientId) });
  const { data: handles = [] } = useQuery({ queryKey: ["client-social-handles", clientId], queryFn: () => repo.listClientSocialHandles(clientId) });
  const { data: gcal } = useQuery({ queryKey: ["global-calendar"], queryFn: repo.ensureGlobalCalendar });
  const { data: calendars, isLoading } = useQuery({ queryKey: ["client-calendars", clientId], queryFn: () => repo.listCalendarsByClient(clientId) });
  const [calId, setCalId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<repo.Calendar | null>(null);
  const [f, setF] = useState({ name: "", industry: "", region: "", theme: "", default_time: "10:00", timezone: "Asia/Kolkata", scope: "GLOBAL" });

  const activeCal = (calendars ?? []).find((c) => c.id === calId) ?? (calendars ?? [])[0] ?? null;
  const { data: events } = useQuery({ queryKey: ["client-events", activeCal?.id], queryFn: () => repo.listClientCalendarEvents(activeCal!.id), enabled: !!activeCal });
  const { data: posts } = useQuery({ queryKey: ["client-posts", clientId], queryFn: () => repo.listClientPosts(clientId) });

  function openNew() {
    setF({ name: "", industry: client?.industry ?? "", region: "", theme: "", default_time: client?.default_time ?? "10:00", timezone: client?.timezone ?? "Asia/Kolkata", scope: client?.scope ?? "GLOBAL" });
    setOpen(true);
  }
  async function create() {
    if (!f.name.trim()) return void toast.error("Give the calendar a name.");
    const id = await repo.createClientCalendar(clientId, { ...f, name: f.name.trim() });
    setOpen(false);
    setCalId(id);
    refresh();
    toast.success("Calendar created — it now follows the Global Calendar");
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!client) return <p>Client not found. <Link to="/clients" className="text-primary underline">Back to Clients</Link></p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/clients" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All clients</Link>
          <h1 className="text-3xl font-semibold sm:text-4xl">{client.name}</h1>
          <p className="mt-1 text-muted-foreground">{[client.industry || "General", client.timezone].filter(Boolean).join(" · ")} · {(calendars ?? []).length} calendar{(calendars ?? []).length === 1 ? "" : "s"}</p>
          {(client.theme || handles.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {client.theme && <span className="rounded-full bg-highlight/15 px-2.5 py-0.5 text-xs font-medium">Theme: {client.theme}</span>}
              {handles.map((handle) => (
                <span key={handle.id} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                  {PLATFORM_LABEL[handle.platform] ?? handle.platform} · {handle.handle}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button variant="highlight" onClick={openNew}><Plus /> New calendar</Button>
      </div>

      <ClientPosts clientId={clientId} />

      {(calendars ?? []).length === 0 ? (
        <EmptyState icon={CalendarDays} title="No calendars for this client" body="Create the client's first calendar, then add events and set posting times." action={<Button variant="highlight" onClick={openNew}><Plus /> New calendar</Button>} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4 shadow-soft">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Calendar</Label>
              <Select value={activeCal?.id ?? ""} onValueChange={(v) => setCalId(v)}>
                <SelectTrigger className="w-64" aria-label="Calendar"><SelectValue /></SelectTrigger>
                <SelectContent>{(calendars ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="ml-auto text-destructive hover:text-destructive" disabled={!activeCal} onClick={() => setDel(activeCal)}><Trash2 /> Delete calendar</Button>
          </div>

          {activeCal && events && <EventWorkspace key={activeCal.id} calendar={activeCal} events={events} posts={posts ?? []} globalCalendarId={gcal?.id} />}
          {activeCal && (
            <p className="text-xs text-muted-foreground">
              This calendar <strong>references</strong> the Global Calendar ({SCOPE_LABEL[activeCal.scope] ?? "Worldwide"} events). Event names and dates are shared — you set this client's own posting times, approvals and schedule.
            </p>
          )}
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New calendar for {client.name}</DialogTitle>
            <DialogDescription>Add events yourself or ask the AI later, then schedule posting times.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cc-name">Name</Label><Input id="cc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Q1 awareness calendar" /></div>
            <div className="space-y-1.5"><Label htmlFor="cc-ind">Industry</Label><IndustrySelect id="cc-ind" value={f.industry} onChange={(v) => setF({ ...f, industry: v })} /></div>
            <div className="space-y-1.5"><Label htmlFor="cc-reg">Country / region</Label><Input id="cc-reg" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="India" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cc-theme">Theme (optional)</Label><Input id="cc-theme" value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} placeholder="Preventive health" /></div>
            <div className="space-y-1.5">
              <Label>Region of events to show</Label>
              <Select value={f.scope} onValueChange={(v) => setF({ ...f, scope: v })}>
                <SelectTrigger aria-label="Region of events"><SelectValue /></SelectTrigger>
                <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s] ?? s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="cc-time">Default posting time</Label><Input id="cc-time" type="time" value={f.default_time} onChange={(e) => setF({ ...f, default_time: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Time zone</Label>
              <Select value={f.timezone} onValueChange={(v) => setF({ ...f, timezone: v })}>
                <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={create}>Create calendar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{del?.name}”?</DialogTitle>
            <DialogDescription>All {del?.event_count ?? 0} events in it are deleted too.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { if (del) { await repo.deleteCalendar(del.id, del.name); setCalId(null); setDel(null); refresh(); toast.success("Calendar deleted"); } }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
