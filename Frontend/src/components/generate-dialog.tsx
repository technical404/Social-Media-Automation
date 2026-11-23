import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMDY, isValidISODate } from "@/lib/dates";
import { buildEventPrompt, mockEventResponse, parseModelJson, validateProposals, type PlanRequest, type Scope } from "@/lib/planner";
import { runAi } from "@/lib/ai/client";
import * as repo from "@/lib/repo";

type ScopeKind = Scope["scope"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function GenerateDialog({
  open,
  onOpenChange,
  calendar,
  selectedDates,
  onProposed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calendar: repo.Calendar;
  selectedDates: string[];
  onProposed: (firstDate: string) => void;
}) {
  const { data: providers = [] } = useQuery({ queryKey: ["providers"], queryFn: repo.listProviders });
  const now = new Date();
  const [kind, setKind] = useState<ScopeKind>("year");
  const [year, setYear] = useState(now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0));
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [date, setDate] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [industry, setIndustry] = useState(calendar.industry);
  const [region, setRegion] = useState(calendar.region);
  const [theme, setTheme] = useState(calendar.theme);
  const [maxEvents, setMaxEvents] = useState(40);
  const [providerId, setProviderId] = useState("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && selectedDates.length) setKind("dates");
  }, [open, selectedDates.length]);

  function buildScope(): Scope | string {
    switch (kind) {
      case "year":
        return { scope: "year", year };
      case "month":
        return { scope: "month", year, month };
      case "date":
        return isValidISODate(date) ? { scope: "date", date } : "Pick the date.";
      case "week":
        return isValidISODate(date) ? { scope: "week", start: date } : "Pick the first day of the week.";
      case "range":
        return isValidISODate(date) && isValidISODate(rangeEnd) ? { scope: "range", start: date, end: rangeEnd } : "Pick a start and end date.";
      case "dates":
        return selectedDates.length ? { scope: "dates", dates: selectedDates } : "Select dates on the calendar first.";
    }
  }

  async function run() {
    const scope = buildScope();
    if (typeof scope === "string") return void toast.error(scope);
    const req: PlanRequest = { prompt, scope, industry, region, theme, maxEvents };
    setBusy(true);
    try {
      const { system, user } = buildEventPrompt(req);
      const call = (u: string) => runAi({ providerId: providerId === "default" ? null : providerId, task: "event_calendar", system, user: u, json: true, mock: () => mockEventResponse(req) });
      let res = await call(user);
      let parsed = parseModelJson(res.text, res.finishReason);
      // One strict retry when the answer was JSON-ish but not valid (prose or broken syntax).
      // A cut-off answer will not improve by asking again, so we report that instead.
      if (!parsed.ok && (parsed.reason === "not_json" || parsed.reason === "malformed")) {
        res = await call(`${user}\n\nYour previous answer was not valid JSON. Reply with ONLY the JSON object — no markdown, no explanation.`);
        parsed = parseModelJson(res.text, res.finishReason);
      }
      if (!parsed.ok) throw new Error(`The AI did not return strict JSON (${parsed.reason}): ${parsed.detail}`);
      const existing = (await repo.listEvents(calendar.id)).map((e) => ({ start_date: e.start_date, name: e.name }));
      const { accepted, rejected } = validateProposals(parsed.value, { scope, existing, maxEvents });
      await repo.saveRun(calendar.id, req, { provider: res.providerName, model: res.model }, accepted, rejected);
      toast.success(`${accepted.length} events proposed — review them before saving`, {
        description: `${res.providerName} · ${(res.ms / 1000).toFixed(1)}s${rejected.length ? ` · ${rejected.length} rejected by checks` : ""}`,
      });
      onOpenChange(false);
      onProposed(accepted[0]?.start_date ?? "");
    } catch (e) {
      toast.error((e as Error).message || "Generation failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ask AI for events</DialogTitle>
          <DialogDescription>You'll see every suggestion first. Nothing is saved until you approve it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="g-prompt">What do you need?</Label>
            <Textarea id="g-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Create a complete medical awareness event calendar for India for 2027." />
          </div>
          <Tabs value={kind} onValueChange={(v) => setKind(v as ScopeKind)}>
            <TabsList className="grid h-auto w-full grid-cols-3 sm:grid-cols-6">
              <TabsTrigger value="date">One day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="year">Year</TabsTrigger>
              <TabsTrigger value="range">Range</TabsTrigger>
              <TabsTrigger value="dates">Selected</TabsTrigger>
            </TabsList>
          </Tabs>
          {(kind === "year" || kind === "month") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger aria-label="Year"><SelectValue /></SelectTrigger>
                  <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {kind === "month" && (
                <div className="space-y-1.5">
                  <Label>Month</Label>
                  <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                    <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {(kind === "date" || kind === "week" || kind === "range") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="g-date">{kind === "date" ? "Date" : kind === "week" ? "Week starts on" : "From"}</Label>
                <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {kind === "range" && (
                <div className="space-y-1.5">
                  <Label htmlFor="g-end">To</Label>
                  <Input id="g-end" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                </div>
              )}
            </div>
          )}
          {kind === "dates" && (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {selectedDates.length
                ? `${selectedDates.length} selected date${selectedDates.length > 1 ? "s" : ""}: ${selectedDates.slice(0, 6).map(formatMDY).join(", ")}${selectedDates.length > 6 ? "…" : ""}`
                : "Close this, turn on “Select dates”, click dates on the calendar, then come back."}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-ind">Industry</Label>
              <Input id="g-ind" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Hospital" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-reg">Country / region</Label>
              <Input id="g-reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="India" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-theme">Theme</Label>
              <Input id="g-theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Women's health" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-max">Max events</Label>
              <Input id="g-max" type="number" min={1} max={150} value={maxEvents} onChange={(e) => setMaxEvents(Math.min(150, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <div className="space-y-1.5">
              <Label>AI provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger aria-label="AI provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Automatic (default provider)</SelectItem>
                  {providers.filter((p) => p.enabled).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {providers.length === 0 && <p className="text-sm text-destructive">No AI provider yet — add one (or the built-in Test provider) in AI Provider Manager.</p>}
        </div>
        <DialogFooter>
          <Button variant="highlight" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {busy ? "Asking the AI…" : "Get suggestions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
