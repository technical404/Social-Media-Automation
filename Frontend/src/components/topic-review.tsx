import { useEffect, useState } from "react";
import { CheckCheck, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CONTENT_TYPES, withCurrent } from "@/lib/planner";
import { PLATFORMS, PLATFORM_LABEL } from "@/lib/platforms";
import { isValidISODate } from "@/lib/dates";
import type { ContentPlanRequest, TopicProposal } from "@/lib/content-planner";
import * as repo from "@/lib/repo";

function parseTags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/\s+/g, ""))
    .filter(Boolean)
    .map((s) => (s.startsWith("#") ? s : `#${s}`))
    .slice(0, 10);
}

/** Keeps the user's raw text (including spaces while typing) while reporting normalized tags. */
function HashtagInput({ value, onChange, label }: { value: string[]; onChange: (tags: string[]) => void; label: string }) {
  const [text, setText] = useState(value.join(" "));
  const normalized = value.join(" ");
  useEffect(() => {
    setText(normalized);
  }, [normalized]);
  return (
    <Input
      className="mt-2 h-8"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseTags(e.target.value));
      }}
      placeholder="#hashtag #hashtag"
      aria-label={label}
    />
  );
}

export function TopicReview({ run, calendar, onDone }: { run: repo.GenerationRun; calendar: repo.Calendar; onDone: () => void }) {
  const [items, setItems] = useState<TopicProposal[]>(() => JSON.parse(run.proposals) as TopicProposal[]);
  const rejected = JSON.parse(run.rejected) as { item: string; reason: string }[];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = JSON.parse(run.request) as ContentPlanRequest;
  const clientId = request.client_id ?? null;
  const clientName = request.client_name ?? null;
  const picked = items.filter((t) => t.selected).length;

  const save = (next: TopicProposal[]) => {
    setItems(next);
    void repo.updateRunProposals(run.id, next);
  };
  const patch = (key: string, p: Partial<TopicProposal>) => save(items.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function commit() {
    const bad = items.find((t) => t.selected && (!t.topic.trim() || !isValidISODate(t.date)));
    if (bad) return void toast.error(`Fix "${bad.topic || "unnamed"}" first — it needs a topic and a valid date.`);
    setBusy(true);
    try {
      const n = await repo.commitTopicRun(run, calendar, items, clientId);
      toast.success(`${n} draft post${n === 1 ? "" : "s"} created${clientName ? ` for ${clientName}` : ""}`, {
        description: "Open Posts & Approvals to review them before scheduling. Nothing was published.",
      });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <section aria-label="AI content calendar" className="space-y-4 rounded-2xl border-2 border-dashed border-highlight bg-accent/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-accent-foreground"><Sparkles className="h-4 w-4" /> AI content calendar — not saved yet</p>
          <h2 className="mt-1 text-xl font-semibold">{items.length} suggested topic{items.length === 1 ? "" : "s"}</h2>
          <p className="text-sm text-muted-foreground">
            From {run.provider_name} ({run.model}).{" "}
            {clientName ? (
              <span className="font-semibold text-foreground">For {clientName} only — approving creates draft posts in Posts &amp; Approvals, not events.</span>
            ) : (
              "Untick, edit or delete anything, then approve."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => save(items.map((x) => ({ ...x, selected: true })))}>Select all</Button>
          <Button variant="outline" size="sm" onClick={() => save(items.map((x) => ({ ...x, selected: false })))}>Select none</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await repo.discardRun(run.id);
              toast.info("Content plan discarded");
              onDone();
            }}
          >
            Discard
          </Button>
          <Button variant="success" size="sm" disabled={!picked || busy} onClick={() => setConfirm(true)}>
            <CheckCheck /> Approve &amp; create {picked}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.key} className={t.selected ? "rounded-xl border bg-card p-3" : "rounded-xl border bg-card p-3 opacity-60"} data-testid="topic-row">
            <div className="flex flex-wrap items-start gap-2">
              <Checkbox checked={t.selected} onCheckedChange={(v) => patch(t.key, { selected: v === true })} aria-label={`Include ${t.topic}`} className="mt-1" />
              <Input type="date" className="h-8 w-36" value={t.date} onChange={(e) => patch(t.key, { date: e.target.value })} aria-label={`Date for ${t.topic}`} />
              <Input className="h-8 min-w-0 flex-1 font-medium" value={t.topic} onChange={(e) => patch(t.key, { topic: e.target.value })} aria-label="Topic" />
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${t.topic}`} onClick={() => save(items.filter((x) => x.key !== t.key))}><Trash2 /></Button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Input className="h-8" value={t.pillar} onChange={(e) => patch(t.key, { pillar: e.target.value })} placeholder="Content pillar" aria-label="Content pillar" />
              <Select value={t.platform} onValueChange={(v) => patch(t.key, { platform: v })}>
                <SelectTrigger className="h-8" aria-label="Platform"><SelectValue /></SelectTrigger>
                <SelectContent>{withCurrent(PLATFORMS, t.platform).map((p) => <SelectItem key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={t.format} onValueChange={(v) => patch(t.key, { format: v })}>
                <SelectTrigger className="h-8" aria-label="Content format"><SelectValue /></SelectTrigger>
                <SelectContent>{withCurrent(CONTENT_TYPES, t.format).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Input className="mt-2 h-8" value={t.brief} onChange={(e) => patch(t.key, { brief: e.target.value })} placeholder="Brief or content angle" aria-label="Brief" />
            <Textarea className="mt-2" rows={2} value={t.caption} onChange={(e) => patch(t.key, { caption: e.target.value })} placeholder="Draft caption" aria-label="Draft caption" />
            <HashtagInput value={t.hashtags} onChange={(tags) => patch(t.key, { hashtags: tags })} label="Hashtags" />
          </div>
        ))}
      </div>

      {rejected.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="link" className="px-0">{rejected.length} item{rejected.length > 1 ? "s" : ""} rejected by the automatic checks — show why</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1 rounded-xl bg-card p-3 text-sm" data-testid="topic-rejected-list">
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
            <AlertDialogTitle>Create {picked} draft post{picked === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be saved for <strong>{clientName ?? "this client"}</strong> at the client&apos;s default time and appear in Posts &amp; Approvals and the Post Calendar. Nothing gets published.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={commit}>Approve &amp; create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
