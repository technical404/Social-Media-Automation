import { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CATEGORIES, CONTENT_TYPES, withCurrent } from "@/lib/planner";
import { isValidISODate } from "@/lib/dates";
import { META_PLATFORMS, PLATFORM_GROUPS, PLATFORM_LABEL, PLATFORMS, contentTypesForPlatforms, platformSummary } from "@/lib/platforms";
import * as repo from "@/lib/repo";
import { cn } from "@/lib/utils";

type Form = repo.EventInput;

// Source fields are no longer edited in this form, but they stay in state so any
// values that came from AI or a spreadsheet survive an edit.
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
  content_format: "",
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

const NONE = "__none__";

function FieldLabel({ label, htmlFor, hint }: { label: string; htmlFor?: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <span className="text-sm font-medium leading-none">{label}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`About ${label}`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function PlatformMultiSelect({ value, onChange, allowed }: { value: string[]; onChange: (value: string[]) => void; allowed?: string[] | undefined }) {
  const clientPlatforms = allowed ? PLATFORMS.filter((p) => allowed.includes(p)) : PLATFORMS;
  // Keep a value that is already on the event editable even if the client no longer lists it.
  const listed = [...clientPlatforms, ...value.filter((p) => !clientPlatforms.includes(p))];
  const metaPlatforms = META_PLATFORMS.filter((p) => listed.includes(p));
  const allMeta = metaPlatforms.length === META_PLATFORMS.length && metaPlatforms.every((p) => value.includes(p));
  const setMany = (platforms: string[]) => onChange(PLATFORMS.filter((p) => platforms.includes(p)));
  const toggleMeta = (checked: boolean) => {
    const others = value.filter((p) => !META_PLATFORMS.includes(p as (typeof META_PLATFORMS)[number]));
    setMany(checked ? [...others, ...metaPlatforms] : others);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal" aria-label="Platforms">
          <span className={cn("truncate text-left", !value.length && "text-muted-foreground")}>
            {value.length ? platformSummary(value) : "Select platforms"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Platforms</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {metaPlatforms.length > 0 && (
          <>
            <DropdownMenuLabel>Meta</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={allMeta}
              disabled={metaPlatforms.length < META_PLATFORMS.length}
              onCheckedChange={(checked) => toggleMeta(checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              Meta <span className="ml-1 text-xs text-muted-foreground">(Facebook + Instagram)</span>
            </DropdownMenuCheckboxItem>
            {PLATFORM_GROUPS.find((g) => g.id === "meta")?.platforms
              .filter((p) => listed.includes(p))
              .map((platform) => (
                <DropdownMenuCheckboxItem
                  key={platform}
                  checked={value.includes(platform)}
                  onCheckedChange={(checked) => setMany(checked === true ? [...value, platform] : value.filter((p) => p !== platform))}
                  onSelect={(event) => event.preventDefault()}
                  className="pl-6"
                >
                  {PLATFORM_LABEL[platform]}
                </DropdownMenuCheckboxItem>
              ))}
            <DropdownMenuSeparator />
          </>
        )}
        {PLATFORM_GROUPS.filter((group) => group.id !== "meta" && group.platforms.some((p) => listed.includes(p))).map((group) => (
          <DropdownMenuCheckboxItem
            key={group.id}
            checked={group.platforms.every((p) => value.includes(p))}
            onCheckedChange={(checked) => {
              const next = checked === true
                ? [...value, ...group.platforms.filter((p) => listed.includes(p))]
                : value.filter((p) => !group.platforms.includes(p));
              setMany(next);
            }}
            onSelect={(event) => event.preventDefault()}
          >
            {group.label}
          </DropdownMenuCheckboxItem>
        ))}
        {!listed.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">This client has no social handles yet.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EventFormDialog({
  open,
  onOpenChange,
  calendarId,
  event,
  defaultDate,
  allowedPlatforms,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calendarId: string;
  event: repo.EventRow | null;
  defaultDate: string;
  /** Platforms the client actually has handles for; omitted means every platform. */
  allowedPlatforms?: string[] | undefined;
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
        content_format: event.content_format,
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
  const setPlatforms = (platforms: string[]) => setF((x) => {
    const allowed = contentTypesForPlatforms(platforms);
    return {
      ...x,
      platforms,
      content_format: x.content_format && !allowed.includes(x.content_format) ? "" : x.content_format,
    };
  });
  const contentOptions = f.platforms.length ? contentTypesForPlatforms(f.platforms) : [...CONTENT_TYPES];

  async function save() {
    if (!f.name.trim()) return void toast.error("Give the event a name.");
    if (!isValidISODate(f.start_date)) return void toast.error("Pick a valid start date.");
    const end = f.end_date && isValidISODate(f.end_date) ? f.end_date : f.start_date;
    if (end < f.start_date) return void toast.error("End date can't be before the start date.");
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
    <TooltipProvider delayDuration={150}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-2xl overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("ev-name")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
            <DialogDescription>Saving any change sends the event back to “Needs review”.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Event name" htmlFor="ev-name" hint="The event or observance name. This is what appears on the calendar." />
              <Input id="ev-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Platforms" hint="Choose every social platform this event should be posted on. Only platforms with a handle on this client's profile can be selected." />
              <PlatformMultiSelect value={f.platforms} onChange={setPlatforms} allowed={allowedPlatforms} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Content type" htmlFor="ev-format" hint="The format to produce. The list follows the platform you choose first." />
              <Select value={f.content_format || NONE} onValueChange={(v) => set("content_format", v === NONE ? "" : v)} disabled={!f.platforms.length}>
                <SelectTrigger id="ev-format" aria-label="Content type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {withCurrent(contentOptions, f.content_format).map((contentType) => (
                    <SelectItem key={contentType} value={contentType}>{contentType}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{f.platforms.length ? "Formats supported by the selected platform(s)." : "Choose a platform first to see its content types."}</p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Start date" htmlFor="ev-start" hint="The first day this event applies to." />
              <Input id="ev-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="End date" htmlFor="ev-end" hint="The last day. Use the same date for a single-day event." />
              <Input id="ev-end" type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Category" htmlFor="ev-cat" hint="Groups the event on the calendar and in filters." />
              <Select value={f.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger id="ev-cat" aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Type" htmlFor="ev-kind" hint="Marks the event as an official observance, an AI suggestion, or your own event." />
              <Select value={f.event_kind} onValueChange={(v) => set("event_kind", v)}>
                <SelectTrigger id="ev-kind" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="official_observance">Official observance</SelectItem>
                  <SelectItem value="ai_suggestion">AI-suggested date</SelectItem>
                  <SelectItem value="custom">My own event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Importance" htmlFor="ev-importance" hint="How much priority the event gets when you plan and review content." />
              <Select value={f.importance} onValueChange={(v) => set("importance", v)}>
                <SelectTrigger id="ev-importance" aria-label="Importance"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Own posting time (optional)" htmlFor="ev-time" hint="Overrides the calendar's default posting time for this event only. Leave blank to use the default." />
              <Input id="ev-time" type="time" value={f.time_override ?? ""} onChange={(e) => set("time_override", e.target.value || null)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Short description" htmlFor="ev-short" hint="A one-line caption angle or summary shown on the event card." />
              <Input id="ev-short" value={f.short_description} onChange={(e) => set("short_description", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Detailed description" htmlFor="ev-long" hint="A fuller brief with context, notes, or ideas for the content team." />
              <Textarea id="ev-long" rows={3} value={f.detailed_description} onChange={(e) => set("detailed_description", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Campaign topic" htmlFor="ev-topic" hint="The campaign or theme this event belongs to, used for grouping." />
              <Input id="ev-topic" value={f.campaign_topic} onChange={(e) => set("campaign_topic", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel label="Hashtags" htmlFor="ev-tags" hint="Suggested hashtags. Separate them with spaces or commas; # is added automatically." />
              <Input id="ev-tags" placeholder="#health #awareness" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{event ? "Save changes" : "Add event"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
