import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/lib/planner";
import { isValidISODate } from "@/lib/dates";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/platforms";
import * as repo from "@/lib/repo";

type Form = repo.EventInput;

const blank = (date: string): Form => ({
  name: "",
  short_description: "",
  detailed_description: "",
  category: "Other",
  start_date: date,
  end_date: date,
  importance: "medium",
  event_kind: "custom",
  source_url: "",
  verification_status: "unverified",
  campaign_topic: "",
  time_override: null,
  hashtags: [],
  platforms: [],
});

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function EventFormDialog({
  open,
  onOpenChange,
  calendarId,
  event,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calendarId: string;
  event: repo.EventRow | null;
  defaultDate: string;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(blank(defaultDate));
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setF({
        name: event.name,
        short_description: event.short_description,
        detailed_description: event.detailed_description,
        category: event.category,
        start_date: event.start_date,
        end_date: event.end_date,
        importance: event.importance,
        event_kind: event.event_kind,
        source_url: event.source_url,
        verification_status: event.verification_status,
        campaign_topic: event.campaign_topic,
        time_override: event.time_override,
        hashtags: parseList(event.hashtags),
        platforms: parseList(event.platforms),
      });
      setTags(parseList(event.hashtags).join(" "));
    } else {
      setF(blank(defaultDate));
      setTags("");
    }
  }, [open, event, defaultDate]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!f.name.trim()) return void toast.error("Give the event a name.");
    if (!isValidISODate(f.start_date)) return void toast.error("Pick a valid start date.");
    const end = f.end_date && isValidISODate(f.end_date) ? f.end_date : f.start_date;
    if (end < f.start_date) return void toast.error("End date can't be before the start date.");
    if (f.source_url && !/^https:\/\//i.test(f.source_url)) return void toast.error("Source link must start with https://");
    const input: Form = {
      ...f,
      name: f.name.trim(),
      end_date: end,
      hashtags: tags.split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    };
    setBusy(true);
    try {
      if (event) await repo.updateEvent(event.id, input);
      else await repo.createEvent(calendarId, input);
      toast.success(event ? "Saved — the event needs review again" : "Event added (needs review)");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      const msg = String((e as Error).message);
      toast.error(/UNIQUE/i.test(msg) ? "An event with this name already exists on that date." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>Saving any change sends the event back to “Needs review”.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-name">Event name</Label>
            <Input id="ev-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-start">Start date</Label>
            <Input id="ev-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-end">End date</Label>
            <Input id="ev-end" type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={f.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={f.event_kind} onValueChange={(v) => set("event_kind", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="official_observance">Official observance</SelectItem>
                <SelectItem value="ai_suggestion">AI-suggested date</SelectItem>
                <SelectItem value="custom">My own event</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Importance</Label>
            <Select value={f.importance} onValueChange={(v) => set("importance", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-time">Own posting time (optional)</Label>
            <Input id="ev-time" type="time" value={f.time_override ?? ""} onChange={(e) => set("time_override", e.target.value || null)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-short">Short description</Label>
            <Input id="ev-short" value={f.short_description} onChange={(e) => set("short_description", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-long">Detailed description</Label>
            <Textarea id="ev-long" rows={3} value={f.detailed_description} onChange={(e) => set("detailed_description", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-src">Official source link</Label>
            <Input id="ev-src" placeholder="https://" value={f.source_url} onChange={(e) => set("source_url", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Source check</Label>
            <Select value={f.verification_status} onValueChange={(v) => set("verification_status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unverified">Not checked</SelectItem>
                <SelectItem value="source_provided">Link given, not checked</SelectItem>
                <SelectItem value="verified">I checked the source</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-topic">Campaign topic</Label>
            <Input id="ev-topic" value={f.campaign_topic} onChange={(e) => set("campaign_topic", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-tags">Hashtags</Label>
            <Input id="ev-tags" placeholder="#health #awareness" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={f.platforms.includes(p)}
                    onCheckedChange={(v) => set("platforms", v ? [...f.platforms, p] : f.platforms.filter((x) => x !== p))}
                  />
                  {PLATFORM_LABEL[p]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{event ? "Save changes" : "Add event"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
