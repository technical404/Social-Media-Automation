// Pure Event Planner logic: request scopes, AI prompt, strict validation, time rules, filters, export.
import { isValidISODate, pad } from "./dates";

export const CATEGORIES = [
  "Awareness day",
  "Awareness week",
  "Awareness month",
  "Holiday",
  "Industry event",
  "Campaign idea",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const EVENT_KINDS = ["official_observance", "ai_suggestion", "custom"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Preset industries for client, calendar and AI-planning forms. */
export const INDUSTRIES = [
  "Healthcare",
  "Hospital",
  "Clinic",
  "Dental",
  "Pharmaceutical",
  "Medical education",
  "Fitness & wellness",
  "Beauty & personal care",
  "Education",
  "Retail",
  "E-commerce",
  "Food & beverage",
  "Hospitality & travel",
  "Finance & banking",
  "Insurance",
  "Real estate",
  "Technology",
  "Software & SaaS",
  "Telecommunications",
  "Manufacturing",
  "Automotive",
  "Construction",
  "Energy & utilities",
  "Logistics & transport",
  "Nonprofit",
  "Government",
  "Media & entertainment",
  "Legal",
  "Consulting",
  "Other",
] as const;

/** Canonical content formats, shared with the spreadsheet importer. */
export const CONTENT_TYPES = [
  "Reel",
  "Static post",
  "Carousel",
  "Story",
  "Video",
  "Short video",
  "Image",
  "Post",
  "Caption",
  "Blog",
  "Email",
  "Poll",
  "Live",
  "GIF",
] as const;

/** Keep a stored custom value selectable even when it is not one of the presets. */
export function withCurrent(options: readonly string[], current: string): string[] {
  const list = [...options];
  return current && !list.includes(current) ? [current, ...list] : list;
}

export type Scope =
  | { scope: "date"; date: string }
  | { scope: "week"; start: string }
  | { scope: "month"; year: number; month: number }
  | { scope: "year"; year: number }
  | { scope: "range"; start: string; end: string }
  | { scope: "dates"; dates: string[] };

export type PlanRequest = {
  prompt: string;
  scope: Scope;
  industry: string;
  region: string;
  theme: string;
  maxEvents: number;
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Inclusive window for a request. */
export function scopeWindow(s: Scope): { start: string; end: string } {
  switch (s.scope) {
    case "date":
      return { start: s.date, end: s.date };
    case "week":
      return { start: s.start, end: addDays(s.start, 6) };
    case "month":
      return { start: `${s.year}-${pad(s.month)}-01`, end: `${s.year}-${pad(s.month)}-${pad(daysInMonth(s.year, s.month))}` };
    case "year":
      return { start: `${s.year}-01-01`, end: `${s.year}-12-31` };
    case "range":
      return s.start <= s.end ? { start: s.start, end: s.end } : { start: s.end, end: s.start };
    case "dates": {
      const d = [...s.dates].sort();
      return { start: d[0] ?? "", end: d[d.length - 1] ?? "" };
    }
  }
}

export function isMedical(industry: string): boolean {
  return /medic|health|hospital|clinic|pharma|doctor|nurs|dental|care/i.test(industry);
}

export function buildEventPrompt(req: PlanRequest): { system: string; user: string } {
  const w = scopeWindow(req.scope);
  const scopeText =
    req.scope.scope === "dates"
      ? `only on these dates: ${req.scope.dates.join(", ")}`
      : `between ${w.start} and ${w.end} inclusive`;
  const system = [
    "You are a careful events researcher for social media teams.",
    "List real, widely recognised observances (awareness days/weeks/months, public holidays, industry events) and, separately, clearly-labelled campaign ideas.",
    "Use the correct date for the requested year; compute moving observances for that year.",
    "NEVER invent an official observance. If you are not sure an observance is official, set event_kind to \"ai_suggestion\".",
    "Only give a source_url you are confident is the official page; otherwise leave it empty.",
    `category must be one of: ${CATEGORIES.join(" | ")}.`,
    "Every start_date must fall inside the requested period; omit events outside it.",
    "Reply with a single JSON object and nothing else. Do NOT wrap it in markdown code fences, and do NOT add any word before or after it.",
    "Your answer must start with { and end with }. Keep every string short so the JSON is always closed properly.",
    "Keep short_description under 90 characters and detailed_description under 160 characters. Use at most 5 hashtags. Do not include image_prompt or video_prompt.",
    'Exact shape: {"events":[{"name":"","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","short_description":"","detailed_description":"","category":"","event_kind":"official_observance|ai_suggestion","importance":"low|medium|high","source_url":"","campaign_topic":"","content_format":"","hashtags":["#tag"]}]}',
  ].join(" ");
  const user = [
    `Request: ${req.prompt || "Build an event calendar."}`,
    `Industry: ${req.industry || "general"}.`,
    req.region ? `Country/region: ${req.region}.` : "",
    req.theme ? `Theme: ${req.theme}.` : "",
    `Find events ${scopeText}.`,
    `At most ${req.maxEvents} events, sorted by date.`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export type Proposal = {
  key: string;
  name: string;
  start_date: string;
  end_date: string;
  short_description: string;
  detailed_description: string;
  category: Category;
  event_kind: EventKind;
  importance: "low" | "medium" | "high";
  source_url: string;
  campaign_topic: string;
  content_format: string;
  hashtags: string[];
  image_prompt: string;
  video_prompt: string;
  selected: boolean;
};

export type Rejected = { item: string; reason: string };

export type StrictJson =
  | { ok: true; value: unknown }
  | { ok: false; reason: "empty" | "truncated" | "not_json" | "malformed"; detail: string };

/** True when the text has unclosed braces/brackets or an open string — i.e. it was cut off. */
function looksTruncated(s: string): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inStr || depth !== 0;
}

/**
 * Strict JSON reader for AI answers. Accepts a single JSON value, optionally wrapped in
 * one ```json fence. Anything else — prose around it, a cut-off answer, broken syntax —
 * is rejected with a precise reason so the caller can retry or explain the failure
 * instead of silently salvaging garbage.
 */
export function parseModelJson(text: string, finishReason?: string | null): StrictJson {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty", detail: "The provider returned an empty answer." };
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = (fence ? (fence[1] ?? trimmed) : trimmed).trim();
  if (!body.startsWith("{") && !body.startsWith("[")) {
    return { ok: false, reason: "not_json", detail: `Expected JSON, got: "${body.slice(0, 60)}${body.length > 60 ? "..." : ""}"` };
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    const sysTruncated = finishReason === "length" || finishReason === "max_tokens" || finishReason === "MAX_TOKENS";
    if (sysTruncated || looksTruncated(body)) {
      return { ok: false, reason: "truncated", detail: "The answer was cut off before the JSON closed." };
    }
    return { ok: false, reason: "malformed", detail: (e as Error).message };
  }
}

/**
 * Recover complete event objects from an answer that the provider cut off.
 * Only whole objects are returned; an incomplete trailing event is dropped.
 * Callers must still run validateProposals() on the result.
 */
export function salvageTruncatedEvents(text: string): unknown[] {
  const trimmed = (text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*)$/);
  const body = (fenced ? fenced[1] : trimmed) ?? "";
  const key = body.search(/"events"\s*:\s*\[/);
  if (key < 0) return [];
  const start = body.indexOf("[", key);
  if (start < 0) return [];
  const out: unknown[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = start + 1; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(body.slice(objStart, i + 1)));
        } catch {
          // Drop a broken item instead of failing the whole answer.
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return out;
}

type RawItem = Partial<Record<"name" | "title" | "start_date" | "date" | "end_date" | "event_kind" | "importance" | "hashtags" | "short_description" | "description" | "detailed_description" | "category" | "source_url" | "campaign_topic" | "content_format" | "image_prompt" | "video_prompt", unknown>> | null;

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normCategory(v: unknown): Category {
  const s = str(v, 60).toLowerCase();
  return (CATEGORIES.find((c) => c.toLowerCase() === s) ?? "Other") as Category;
}

function normUrl(v: unknown): string {
  const s = str(v, 500);
  return /^https:\/\/[^\s]+\.[^\s]+$/i.test(s) ? s : "";
}

/** Strict validation of AI output; everything that fails gets a human-readable reason. */
export function validateProposals(
  raw: unknown,
  ctx: { scope: Scope; existing: { start_date: string; name: string }[]; maxEvents: number },
): { accepted: Proposal[]; rejected: Rejected[] } {
  const list = Array.isArray(raw) ? raw : (raw as { events?: unknown })?.events;
  if (!Array.isArray(list)) return { accepted: [], rejected: [{ item: "AI answer", reason: "No events list in the answer." }] };
  const w = scopeWindow(ctx.scope);
  const allowed = ctx.scope.scope === "dates" ? new Set(ctx.scope.dates) : null;
  const seen = new Set(ctx.existing.map((e) => `${e.start_date}|${e.name.trim().toLowerCase()}`));
  const accepted: Proposal[] = [];
  const rejected: Rejected[] = [];

  for (const it of list as RawItem[]) {
    const name = str(it?.name ?? it?.title, 160);
    const start = str(it?.start_date ?? it?.date, 10);
    const endRaw = str(it?.end_date, 10) || start;
    const label = name || "(no name)";
    if (!name) { rejected.push({ item: label, reason: "Missing event name." }); continue; }
    if (!isValidISODate(start)) { rejected.push({ item: label, reason: `Invalid date "${start}".` }); continue; }
    if (!isValidISODate(endRaw) || endRaw < start) { rejected.push({ item: label, reason: `Invalid end date "${endRaw}".` }); continue; }
    if (start < w.start || start > w.end) { rejected.push({ item: label, reason: `Date ${start} is outside the requested period.` }); continue; }
    if (allowed && !allowed.has(start)) { rejected.push({ item: label, reason: `Date ${start} was not one of the selected dates.` }); continue; }
    const k = `${start}|${name.toLowerCase()}`;
    if (seen.has(k)) { rejected.push({ item: label, reason: "Duplicate of an event already listed." }); continue; }
    if (accepted.length >= ctx.maxEvents) { rejected.push({ item: label, reason: `Over the limit of ${ctx.maxEvents} events.` }); continue; }
    seen.add(k);
    const kind = it?.event_kind === "official_observance" ? "official_observance" : "ai_suggestion";
    const imp = it?.importance === "high" || it?.importance === "low" ? it.importance : "medium";
    const tags = Array.isArray(it?.hashtags) ? (it.hashtags as unknown[]).map((h) => str(h, 60).replace(/\s+/g, "")).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 15) : [];
    accepted.push({
      key: k,
      name,
      start_date: start,
      end_date: endRaw,
      short_description: str(it?.short_description ?? it?.description, 400),
      detailed_description: str(it?.detailed_description, 2000),
      category: normCategory(it?.category),
      event_kind: kind,
      importance: imp as Proposal["importance"],
      source_url: normUrl(it?.source_url),
      campaign_topic: str(it?.campaign_topic, 200),
      content_format: str(it?.content_format, 120),
      hashtags: tags,
      image_prompt: str(it?.image_prompt, 800),
      video_prompt: str(it?.video_prompt, 800),
      selected: true,
    });
  }
  accepted.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));
  return { accepted, rejected };
}

/** Individual overrides always win over the calendar default. */
export function effectiveTime(ev: { time_override: string | null }, cal: { default_time: string }): string {
  return ev.time_override || cal.default_time;
}

export type EventLike = {
  id: string;
  name: string;
  short_description: string;
  category: string;
  start_date: string;
  approval_status: string;
  publish_status: string;
};

export type ListFilters = {
  q: string;
  category: string; // "all" or a category
  status: string; // "all" | approval_status | publish_status
  from: string;
  to: string;
  sort: "date_asc" | "date_desc" | "name_asc" | "name_desc";
};

export function filterAndSort<T extends EventLike>(events: T[], f: ListFilters): T[] {
  const q = f.q.trim().toLowerCase();
  const out = events.filter((e) => {
    if (q && !`${e.name} ${e.short_description} ${e.category}`.toLowerCase().includes(q)) return false;
    if (f.category !== "all" && e.category !== f.category) return false;
    if (f.status !== "all" && e.approval_status !== f.status && e.publish_status !== f.status) return false;
    if (f.from && e.start_date < f.from) return false;
    if (f.to && e.start_date > f.to) return false;
    return true;
  });
  const dir = f.sort.endsWith("desc") ? -1 : 1;
  return out.sort((a, b) =>
    f.sort.startsWith("date")
      ? dir * (a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
      : dir * a.name.localeCompare(b.name),
  );
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/**
 * Deterministic "Test provider" answer: known dates per month in the window, plus
 * three deliberately bad items so validation is visible (out of range, invalid date, duplicate).
 */
export function mockEventResponse(req: PlanRequest): string {
  const w = scopeWindow(req.scope);
  const events: { start_date: string; [k: string]: unknown }[] = [];
  const startY = Number(w.start.slice(0, 4));
  const endY = Number(w.end.slice(0, 4));
  const months: [number, number][] = [];
  for (let y = startY; y <= endY; y++) for (let m = 1; m <= 12; m++) months.push([y, m]);
  const field = req.industry || "General";
  for (const [y, m] of months) {
    const mm = pad(m);
    const add = (d: string, name: string, cat: string, kind = "ai_suggestion") => {
      if (d >= w.start && d <= w.end && (req.scope.scope !== "dates" || req.scope.dates.includes(d)))
        events.push({ name, start_date: d, end_date: d, category: cat, event_kind: kind, short_description: `Test event for ${field} on ${d}.`, hashtags: ["#test", `#${field.replace(/\W+/g, "")}`] });
    };
    add(`${y}-${mm}-01`, `${field} monthly kickoff`, "Campaign idea");
    add(`${y}-${mm}-15`, `${field} mid-month tips`, "Campaign idea");
    add(`${y}-${mm}-15`, `${field} community Q&A`, "Industry event");
    if (m === 2 && isLeapYear(y)) add(`${y}-02-29`, "Leap day special", "Campaign idea");
  }
  if (req.scope.scope === "date" || req.scope.scope === "dates") {
    const ds = req.scope.scope === "date" ? [req.scope.date] : req.scope.dates;
    for (const d of ds) if (!events.some((e) => e.start_date === d)) events.push({ name: `${field} focus day`, start_date: d, end_date: d, category: "Campaign idea", short_description: `Test event for ${field} on ${d}.` });
  }
  events.push({ name: "Outside the period", start_date: "1999-01-01", category: "Other" });
  events.push({ name: "Broken date", start_date: `${startY}-02-30`, category: "Other" });
  if (events[0]) events.push({ ...events[0] });
  return JSON.stringify({ events });
}
