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
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/platforms";
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

const EMPTY = { name: "", description: "", industry: "", theme: "", timezone: "Asia/Kolkata", default_time: "10:00", scope: "GLOBAL" };
type HandleDraft = { platform: string; handle: string };

function ClientsPage() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const { timezone } = useAppSettings();
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const { data: counts = [] } = useQuery({ queryKey: ["client-calendar-counts"], queryFn: repo.countCalendarsByClient });
  const { data: allHandles = [] } = useQuery({ queryKey: ["client-social-handles"], queryFn: repo.listAllClientSocialHandles });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<repo.Client | null>(null);
  const [del, setDel] = useState<repo.Client | null>(null);
  const [f, setF] = useState(EMPTY);
  const [handles, setHandles] = useState<HandleDraft[]>([]);

  const countMap = new Map(counts.map((c) => [c.client_id, c.n]));
  const handlesByClient = new Map<string, repo.ClientSocialHandle[]>();
  for (const handle of allHandles) {
    const list = handlesByClient.get(handle.client_id) ?? [];
    list.push(handle);
    handlesByClient.set(handle.client_id, list);
  }

  function openNew() {
    setEditing(null);
    setF({ ...EMPTY, timezone });
    setHandles([]);
    setOpen(true);
  }
  function openEdit(c: repo.Client) {
    setEditing(c);
    setF({ name: c.name, description: c.description, industry: c.industry, theme: c.theme, timezone: c.timezone, default_time: c.default_time, scope: c.scope });
    setHandles((handlesByClient.get(c.id) ?? []).map((h) => ({ platform: h.platform, handle: h.handle })));
    setOpen(true);
  }
  async function save() {
    if (!f.name.trim()) return void toast.error("Give the client a name.");
    const id = await repo.saveClient(editing?.id ?? null, { ...f, name: f.name.trim() });
    await repo.replaceClientSocialHandles(id, handles);
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
                {c.theme && <p className="mt-2 text-xs font-medium text-muted-foreground">Theme: {c.theme}</p>}
                {(handlesByClient.get(c.id) ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(handlesByClient.get(c.id) ?? []).slice(0, 4).map((h) => (
                      <span key={h.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {PLATFORM_LABEL[h.platform] ?? h.platform} · {h.handle}
                      </span>
                    ))}
                    {(handlesByClient.get(c.id) ?? []).length > 4 && <span className="text-[11px] text-muted-foreground">+{(handlesByClient.get(c.id) ?? []).length - 4}</span>}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>{editing ? "Update this client's details." : "You can add calendars and events right after."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-name">Name</Label><Input id="cl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Hospital" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-ind">Industry</Label><IndustrySelect id="cl-ind" value={f.industry} onChange={(v) => setF({ ...f, industry: v })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-desc">Description (optional)</Label><Textarea id="cl-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Context, contacts, goals…" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cl-theme">Content theme (optional)</Label><Input id="cl-theme" value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} placeholder="Preventive health" /><p className="text-xs text-muted-foreground">Used to filter the client's Global Calendar view and to keep AI ideas on-theme.</p></div>
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
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Social handles</Label>
                  <p className="text-xs text-muted-foreground">Only these platforms can be chosen on this client's events and posts.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setHandles([...handles, { platform: "instagram", handle: "" }])}>
                  <Plus /> Add handle
                </Button>
              </div>
              {handles.length === 0 && <p className="text-xs text-muted-foreground">No handles yet. Add Instagram, Facebook, LinkedIn or another platform.</p>}
              {handles.map((handle, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select value={handle.platform} onValueChange={(platform) => setHandles(handles.map((h, i) => (i === index ? { ...h, platform } : h)))}>
                    <SelectTrigger className="w-36" aria-label={`Platform ${index + 1}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((platform) => <SelectItem key={platform} value={platform}>{PLATFORM_LABEL[platform]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={handle.handle}
                    onChange={(e) => setHandles(handles.map((h, i) => (i === index ? { ...h, handle: e.target.value } : h)))}
                    placeholder="@handle or page name"
                    aria-label={`Handle for platform ${index + 1}`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-destructive hover:text-destructive"
                    aria-label={`Remove platform ${index + 1}`}
                    onClick={() => setHandles(handles.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
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