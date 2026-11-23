import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IndustrySelect } from "@/components/industry-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMDY, isValidISODate } from "@/lib/dates";
import { buildEventPrompt, mockEventResponse, parseModelJson, salvageTruncatedArray, salvageTruncatedEvents, validateProposals, type PlanRequest, type Scope } from "@/lib/planner";
import { buildTopicPrompt, mockTopicResponse, validateTopics, type ContentPlanRequest } from "@/lib/content-planner";
import { runAi } from "@/lib/ai/client";
import * as repo from "@/lib/repo";

type ScopeKind = Scope["scope"];
type Mode = "events" | "topics";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NO_CLIENT = "__global__";

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
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: repo.listClients });
  const now = new Date();
  const [mode, setMode] = useState<Mode>("events");
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
  const [maxTopics, setMaxTopics] = useState(12);
  const [providerId, setProviderId] = useState("default");
  const [clientId, setClientId] = useState(calendar.client_id ?? NO_CLIENT);
  const [clientCalId, setClientCalId] = useState<string | null>(calendar.client_id ? calendar.id : null);
  const [clientLoading, setClientLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const fixedClientId = calendar.client_id;
  const targetClientId = fixedClientId ?? (clientId === NO_CLIENT ? null : clientId);
  const targetClient = clients.find((c) => c.id === targetClientId) ?? null;

  async function pickClient(id: string) {
    setClientId(id);
    setClientCalId(null);
    if (id === NO_CLIENT) {
      setIndustry(calendar.industry);
      setRegion(calendar.region);
      setTheme(calendar.theme);
      return;
    }
    setClientLoading(true);
    try {
      const [client, calendars] = await Promise.all([repo.getClient(id), repo.listCalendarsByClient(id)]);
      const cal = calendars[0];
      setClientCalId(cal?.id ?? null);
      setIndustry(cal?.industry || client?.industry || "");
      setRegion(cal?.region || "");
      setTheme(cal?.theme || "");
    } catch (e) {
      toast.error(`Could not load that client: ${(e as Error).message}`);
    } finally {
      setClientLoading(false);
    }
  }

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
    setBusy(true);
    try {
      if (mode === "topics") {
        if (!targetClientId) return void toast.error("Choose a client for a topic-wise content calendar.");
        await generateTopics(scope, targetClientId, targetClient?.name ?? null);
      } else {
        await generateEvents(scope);
      }
    } catch (e) {
      toast.error((e as Error).message || "Generation failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function generateEvents(scope: Scope) {
    const req: PlanRequest = { prompt, scope, industry, region, theme, maxEvents, client_id: targetClientId, client_name: targetClient?.name ?? null };
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
    // Large lists can hit the provider's output limit. Keep the events that were
    // completed before the cut instead of losing the whole answer.
    let truncated = false;
    if (!parsed.ok && parsed.reason === "truncated") {
      const salvaged = salvageTruncatedEvents(res.text);
      if (salvaged.length) {
        parsed = { ok: true, value: { events: salvaged } };
        truncated = true;
      }
    }
    if (!parsed.ok) {
      const hint = parsed.reason === "truncated"
        ? " Lower “Max events”, or raise this provider's “Max output” in AI Providers and try again."
        : "";
      throw new Error(`The AI did not return strict JSON (${parsed.reason}): ${parsed.detail}${hint}`);
    }
    const existingRows = targetClientId && clientCalId
      ? await repo.listClientCalendarEvents(clientCalId)
      : await repo.listEvents(calendar.id);
    const existing = existingRows.map((e) => ({ start_date: e.start_date, name: e.name }));
    const { accepted, rejected } = validateProposals(parsed.value, { scope, existing, maxEvents });
    if (truncated) {
      if (!accepted.length) {
        throw new Error("The AI answer was cut off before any complete event could be recovered. Lower “Max events”, or raise this provider's “Max output” in AI Providers and try again.");
      }
      rejected.push({ item: "AI answer", reason: `The provider cut the answer off; only the ${accepted.length} complete event(s) were kept. Lower “Max events” for a complete list.` });
    }
    await repo.saveRun(calendar.id, req, { provider: res.providerName, model: res.model }, accepted, rejected);
    if (truncated) {
      toast.warning(`${accepted.length} complete events recovered from a cut-off answer`, {
        description: `${res.providerName} · ${(res.ms / 1000).toFixed(1)}s${targetClient ? ` · for ${targetClient.name}` : ""} · output limit reached. Review them, or lower “Max events” and ask again for the full list.`,
      });
    } else {
      toast.success(`${accepted.length} events proposed${targetClient ? ` for ${targetClient.name}` : ""} — review them before saving`, {
        description: `${res.providerName} · ${(res.ms / 1000).toFixed(1)}s${rejected.length ? ` · ${rejected.length} rejected by checks` : ""}${targetClient ? ` · saved only in ${targetClient.name}'s calendar` : ""}`,
      });
    }
    onOpenChange(false);
    onProposed(accepted[0]?.start_date ?? "");
  }

  async function generateTopics(scope: Scope, clientId: string, clientName: string | null) {
    const req: ContentPlanRequest = { prompt, scope, industry, region, theme, maxTopics, client_id: clientId, client_name: clientName };
    const { system, user } = buildTopicPrompt(req);
    const call = (u: string) => runAi({ providerId: providerId === "default" ? null : providerId, task: "content_calendar", system, user: u, json: true, mock: () => mockTopicResponse(req) });
    let res = await call(user);
    let parsed = parseModelJson(res.text, res.finishReason);
    if (!parsed.ok && (parsed.reason === "not_json" || parsed.reason === "malformed")) {
      res = await call(`${user}\n\nYour previous answer was not valid JSON. Reply with ONLY the JSON object — no markdown, no explanation.`);
      parsed = parseModelJson(res.text, res.finishReason);
    }
    let truncated = false;
    if (!parsed.ok && parsed.reason === "truncated") {
      const salvaged = salvageTruncatedArray(res.text, "topics");
      if (salvaged.length) {
        parsed = { ok: true, value: { topics: salvaged } };
        truncated = true;
      }
    }
    if (!parsed.ok) {
      const hint = parsed.reason === "truncated"
        ? " Lower “Max topics”, or raise this provider's “Max output” in AI Providers and try again."
        : "";
      throw new Error(`The AI did not return strict JSON (${parsed.reason}): ${parsed.detail}${hint}`);
    }
    const existingRows = await repo.listClientPosts(clientId);
    const existing = existingRows
      .filter((p) => p.topic && p.scheduled_at)
      .map((p) => ({ date: (p.scheduled_at as string).slice(0, 10), topic: p.topic, platform: p.platform }));
    const { accepted, rejected } = validateTopics(parsed.value, { scope, existing, maxTopics });
    if (truncated) {
      if (!accepted.length) {
        throw new Error("The AI answer was cut off before any complete topic could be recovered. Lower “Max topics”, or raise this provider's “Max output” in AI Providers and try again.");
      }
      rejected.push({ item: "AI answer", reason: `The provider cut the answer off; only the ${accepted.length} complete topic(s) were kept. Lower “Max topics” for a complete list.` });
    }
    const forWhom = clientName ? ` for ${clientName}` : "";
    await repo.saveRun(calendar.id, req, { provider: res.providerName, model: res.model }, accepted, rejected, "topics");
    if (truncated) {
      toast.warning(`${accepted.length} complete topics recovered from a cut-off answer`, {
        description: `${res.providerName} · ${(res.ms / 1000).toFixed(1)}s${forWhom} · output limit reached. Review them, or lower “Max topics” and ask again.`,
      });
    } else {
      toast.success(`${accepted.length} topics planned${forWhom} — review them before saving`, {
        description: `${res.providerName} · ${(res.ms / 1000).toFixed(1)}s${rejected.length ? ` · ${rejected.length} rejected by checks` : ""} · approving creates draft posts`,
      });
    }
    onOpenChange(false);
    onProposed(accepted[0]?.date ?? "");
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 1 + i);
  const maxItems = mode === "topics" ? maxTopics : maxEvents;
  const setMaxItems = mode === "topics" ? setMaxTopics : setMaxEvents;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "topics" ? "Ask AI for a content calendar" : "Ask AI for events"}</DialogTitle>
          <DialogDescription>
            {mode === "topics"
              ? "Plan topic-wise social posts for a client. Nothing becomes a post until you approve it."
              : "You'll see every suggestion first. Nothing is saved until you approve it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => {
            const next = v as Mode;
            setMode(next);
            // A content calendar must belong to a client; pick the first one instead of
            // making the user hit an avoidable error.
            if (next === "topics" && !fixedClientId && clientId === NO_CLIENT && clients[0]) void pickClient(clients[0].id);
          }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="topics">Social topics</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-1.5">
            <Label htmlFor="g-prompt">What do you need?</Label>
            <Textarea
              id="g-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "topics"
                ? "Plan a month of Instagram and LinkedIn posts about diabetes care for a hospital."
                : "Create a complete medical awareness event calendar for India for 2027."}
            />
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
          {!fixedClientId && (
            <div className="space-y-1.5">
              <Label htmlFor="g-client">Client</Label>
              <Select value={clientId} onValueChange={(v) => void pickClient(v)} disabled={busy || clientLoading}>
                <SelectTrigger id="g-client" aria-label="Client"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT} disabled={mode === "topics"}>Global (shared with all clients)</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === "topics"
                  ? targetClient
                    ? `Topics will become draft posts for ${targetClient.name} only.`
                    : "Choose a client — topic calendars are client-specific."
                  : targetClient
                    ? `These events are client-specific: they will appear only in ${targetClient.name}'s calendar.`
                    : "Choose a client to keep these events out of the shared Global Calendar."}
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-ind">Industry</Label>
              <IndustrySelect id="g-ind" value={industry} onChange={setIndustry} />
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
              <Label htmlFor="g-max">{mode === "topics" ? "Max topics" : "Max events"}</Label>
              <Input id="g-max" type="number" min={1} max={150} value={maxItems} onChange={(e) => setMaxItems(Math.min(150, Math.max(1, Number(e.target.value) || 1)))} />
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
          <Button variant="highlight" onClick={run} disabled={busy || clientLoading}>
            {busy || clientLoading ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {clientLoading ? "Loading client…" : busy ? (mode === "topics" ? "Planning content…" : "Asking the AI…") : (mode === "topics" ? "Plan content" : "Get suggestions")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
