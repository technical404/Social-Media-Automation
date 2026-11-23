import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ThreeMonthCalendar, type DayItem } from "@/components/three-month-calendar";
import { CATEGORIES, isMedical, type Proposal, type Rejected } from "@/lib/planner";
import { isValidISODate } from "@/lib/dates";
import * as repo from "@/lib/repo";

export function ProposalReview({ run, calendar, onDone }: { run: repo.GenerationRun; calendar: repo.Calendar; onDone: () => void }) {
  const [items, setItems] = useState<Proposal[]>(() => JSON.parse(run.proposals) as Proposal[]);
  const rejected = JSON.parse(run.rejected) as Rejected[];
  const [start, setStart] = useState(() => new Date(`${items[0]?.start_date ?? new Date().toISOString().slice(0, 10)}T00:00:00`));
  const [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const medical = isMedical(calendar.industry) || isMedical(JSON.parse(run.request).industry ?? "");
  const picked = items.filter((p) => p.selected).length;
  const official = items.filter((p) => p.selected && p.event_kind === "official_observance").length;

  const save = (next: Proposal[]) => {
    setItems(next);
    void repo.updateRunProposals(run.id, next);
  };
  const patch = (key: string, p: Partial<Proposal>) => save(items.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const dayItems = useMemo(() => {
    const m = new Map<string, DayItem[]>();
    for (const p of items.filter((x) => x.selected)) {
      const l = m.get(p.start_date) ?? [];
      l.push({ name: p.name, category: p.category, approval_status: "approved", publish_status: "not_scheduled" });
      m.set(p.start_date, l);
    }
    return m;
  }, [items]);

  async function commit() {
    const bad = items.find((p) => p.selected && (!p.name.trim() || !isValidISODate(p.start_date)));
    if (bad) return void toast.error(`Fix "${bad.name || "unnamed"}" first — it needs a name and a valid date.`);
    setBusy(true);
    try {
      const n = await repo.commitRun(run, calendar, items.map((p) => ({ ...p, end_date: p.end_date < p.start_date ? p.start_date : p.end_date })));
      toast.success(`${n} events approved and saved`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <section aria-label="AI proposal" className="space-y-4 rounded-2xl border-2 border-dashed border-highlight bg-accent/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-accent-foreground"><Sparkles className="h-4 w-4" /> AI proposal — not saved yet</p>
          <h2 className="mt-1 text-xl font-semibold">{items.length} suggested events</h2>
          <p className="text-sm text-muted-foreground">From {run.provider_name} ({run.model}). Untick, edit or delete anything, then approve.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => save(items.map((x) => ({ ...x, selected: true })))}>Select all</Button>
          <Button variant="outline" size="sm" onClick={() => save(items.map((x) => ({ ...x, selected: false })))}>Select none</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await repo.discardRun(run.id);
              toast.info("Proposal discarded");
              onDone();
            }}
          >
            Discard
          </Button>
          <Button variant="success" size="sm" disabled={!picked || busy || (medical && !reviewed)} onClick={() => setConfirm(true)}>
            <CheckCheck /> Approve & save {picked}
          </Button>
        </div>
      </div>

      {medical && (
        <label className="flex items-start gap-3 rounded-xl border border-warning bg-warning/20 p-3 text-sm">
          <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} aria-label="I reviewed the medical events" />
          <span>
            <span className="inline-flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Medical calendar — human check required.</span>{" "}
            AI can get observance dates wrong. Check each official observance against its source (WHO, the health ministry, the organising body) before approving.
          </span>
        </label>
      )}

      <ThreeMonthCalendar start={start} onShift={(n) => setStart((d) => new Date(d.getFullYear(), d.getMonth() + n, 1))} items={dayItems} compact />

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 p-2" />
              <th className="p-2">Date</th>
              <th className="p-2">Event</th>
              <th className="p-2">Category</th>
              <th className="p-2">Type</th>
              <th className="p-2">Source</th>
              <th className="w-10 p-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.key} className={p.selected ? "border-t" : "border-t opacity-50"} data-testid="proposal-row">
                <td className="p-2"><Checkbox checked={p.selected} onCheckedChange={(v) => patch(p.key, { selected: v === true })} aria-label={`Include ${p.name}`} /></td>
                <td className="p-2"><Input type="date" className="h-8 w-36" value={p.start_date} onChange={(e) => patch(p.key, { start_date: e.target.value })} aria-label={`Date for ${p.name}`} /></td>
                <td className="p-2">
                  <Input className="h-8" value={p.name} onChange={(e) => patch(p.key, { name: e.target.value })} aria-label="Event name" />
                  {p.short_description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.short_description}</p>}
                </td>
                <td className="p-2">
                  <Select value={p.category} onValueChange={(v) => patch(p.key, { category: v as Proposal["category"] })}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                <td className="p-2 text-xs">
                  {p.event_kind === "official_observance" ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Official (claimed)</span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">AI suggestion</span>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {p.source_url ? (
                    <a href={p.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">Open <ExternalLink className="h-3 w-3" /></a>
                  ) : (
                    <span className="text-muted-foreground">None given</span>
                  )}
                </td>
                <td className="p-2">
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${p.name}`} onClick={() => save(items.filter((x) => x.key !== p.key))}><Trash2 /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejected.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="link" className="px-0">{rejected.length} item{rejected.length > 1 ? "s" : ""} rejected by the automatic checks — show why</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1 rounded-xl bg-card p-3 text-sm" data-testid="rejected-list">
              {rejected.map((r, i) => (
                <li key={i}><span className="font-medium">{r.item}</span> — <span className="text-muted-foreground">{r.reason}</span></li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve and save {picked} events?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be added to “{calendar.name}” using its default time ({calendar.default_time}, {calendar.timezone}). {official > 0 && `${official} are marked as official observances by the AI — make sure you checked them. `}Nothing gets posted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={commit}>Approve & save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
