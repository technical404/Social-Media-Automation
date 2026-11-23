import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarRange, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { IndustrySelect } from "@/components/industry-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONES, formatTime12 } from "@/lib/dates";
import { SCOPES, SCOPE_LABEL } from "@/lib/global-calendar";
import { useAppSettings, useRefresh } from "@/lib/hooks";
import * as repo from "@/lib/repo";

export const Route = createFileRoute("/_app/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — SocialAI Studio" },
      { name: "description", content: "Manage clients and open a dedicated event scheduler for each one." },
    ],
  }),
  component: ClientsPage,
});

const EMPTY = { name: "", description: "", industry: "", timezone: "Asia/Kolkata", default_time: "10:00", scope: "GLOBAL" };

function ClientsPage() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const { timezone } = useAppSettings();
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const { data: counts = [] } = useQuery({ queryKey: ["client-calendar-counts"], queryFn: repo.countCalendarsByClient });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<repo.Client | null>(null);
  const [del, setDel] = useState<repo.Client | null>(null);
  const [f, setF] = useState(EMPTY);

  const countMap = new Map(counts.map((c) => [c.client_id, c.n]));

  function openNew() {
    setEditing(null);
    setF({ ...EMPTY, timezone });
    setOpen(true);
  }
  function openEdit(c: repo.Client) {
    setEditing(c);
    setF({ name: c.name, description: c.description, industry: c.industry, timezone: c.timezone, default_time: c.default_time, scope: c.scope });
    setOpen(true);
  }
  async function save() {
    if (!f.name.trim()) return void toast.error("Give the client a name.");
    await repo.saveClient(editing?.id ?? null, { ...f, name: f.name.trim() });
    toast.success(editing ? "Client updated" : "Client created");
    setOpen(false);
    refresh();
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="One workspace per client. Open a client to build and schedule its event calendars."
        actions={<Button variant="highlight" onClick={openNew}><Plus /> New client</Button>}
      />

      {!isLoading && clients.length === 0 ? (
        <EmptyState icon={Users} title="No clients yet" body="Create a client, then give it one or more event calendars with their own posting times." action={<Button variant="highlight" onClick={openNew}><Plus /> New client</Button>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <li key={c.id} className="group relative rounded-2xl border bg-card shadow-soft transition-colors hover:border-primary/40">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="absolute right-3 top-3 z-10 h-8 w-8 opacity-60 group-hover:opacity-100" aria-label={`Options for ${c.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => navigate({ to: "/clients/$clientId", params: { clientId: c.id } })}>
                    <CalendarRange /> Open scheduler
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openEdit(c)}>
                    <Pencil /> Edit client
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDel(c)}>
                    <Trash2 /> Delete client
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Link to="/clients/$clientId" params={{ clientId: c.id }} className="block p-5">
                <h2 className="text-xl font-semibold">{c.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{[c.industry || "General", SCOPE_LABEL[c.scope] ?? "Worldwide", c.timezone].filter(Boolean).join(" · ")}</p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Calendars</dt><dd className="font-semibold tabular-nums">{countMap.get(c.id) ?? 0}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Default time</dt><dd className="font-semibold">{formatTime12(c.default_time)}</dd></div>
                </dl>
                {c.description && <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>{editing ? "Update this client's details." : "You can add calendars and events right after."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-name">Name</Label><Input id="cl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Hospital" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-ind">Industry</Label><IndustrySelect id="cl-ind" value={f.industry} onChange={(v) => setF({ ...f, industry: v })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-desc">Description (optional)</Label><Textarea id="cl-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Context, contacts, goals…" /></div>
            <div className="space-y-1.5"><Label htmlFor="cl-time">Default posting time</Label><Input id="cl-time" type="time" value={f.default_time} onChange={(e) => setF({ ...f, default_time: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Time zone</Label>
              <Select value={f.timezone} onValueChange={(v) => setF({ ...f, timezone: v })}>
                <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Region of events</Label>
              <Select value={f.scope} onValueChange={(v) => setF({ ...f, scope: v })}>
                <SelectTrigger aria-label="Region of events"><SelectValue /></SelectTrigger>
                <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s] ?? s}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Worldwide events always show; this adds the client's own country's observances.</p>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>{editing ? "Save changes" : "Create client"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{del?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Every calendar and event that belongs to this client is deleted too. Make a backup first if you might need them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (del) { await repo.deleteClient(del.id, del.name); refresh(); toast.success("Client deleted"); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}