// Topic-wise social media planning: prompt, strict validation and the deterministic test answer.
// A topic is a content angle that becomes a dated draft post — it is not a public event.
import { isValidISODate, pad } from "./dates";
import { CONTENT_TYPES, isMedical, scopeWindow, type Rejected, type Scope } from "./planner";
import { PLATFORMS } from "./platforms";

export type ContentPlanRequest = {
  prompt: string;
  scope: Scope;
  industry: string;
  region: string;
  theme: string;
  maxTopics: number;
  client_id?: string | null;
  client_name?: string | null;
};

export type TopicProposal = {
  key: string;
  date: string;
  topic: string;
  pillar: string;
  platform: string;
  format: string;
  brief: string;
  caption: string;
  hashtags: string[];
  selected: boolean;
};

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const PLATFORM_ALIAS: Record<string, string> = {
  ig: "instagram",
  insta: "instagram",
  instagram: "instagram",
  fb: "facebook",
  facebook: "facebook",
  li: "linkedin",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  tweet: "x",
  xcom: "x",
  yt: "youtube",
  youtube: "youtube",
  tiktok: "tiktok",
  pinterest: "pinterest",
};

export function normalizePlatform(v: unknown): string {
  const key = str(v, 40).toLowerCase().replace(/[^a-z]/g, "");
  return PLATFORM_ALIAS[key] ?? key;
}

export function normalizeFormat(v: unknown): string {
  const raw = str(v, 60);
  const hit = CONTENT_TYPES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return hit ?? (raw || "Static post");
}

export function buildTopicPrompt(req: ContentPlanRequest): { system: string; user: string } {
  const w = scopeWindow(req.scope);
  const scopeText =
    req.scope.scope === "dates"
      ? `only on these dates: ${req.scope.dates.join(", ")}`
      : `between ${w.start} and ${w.end} inclusive`;
  const system = [
    "You are a social media content strategist.",
    "Build a topic-wise content calendar: distinct post ideas, not a list of public holidays or observances.",
    "Each topic must be a clear content angle with a short brief and a ready-to-edit caption for the client.",
    "Vary the content pillars (for example Education, Awareness, Services, Trust/Behind the scenes, Patient stories, Engagement) and vary platforms and formats across the plan.",
    "Use realistic dates inside the requested period and spread the topics with a sensible cadence.",
    "Do not invent facts, statistics, awards or official claims.",
    isMedical(req.industry) ? "Do not give medical advice or diagnosis; keep captions educational and non-promotional about treatment outcomes." : "",
    "Reply with a single JSON object and nothing else. Do NOT wrap it in markdown code fences, and do NOT add any word before or after it.",
    "Your answer must start with { and end with }. Keep every string short so the JSON is always closed properly.",
    "brief under 180 characters, caption under 450 characters, at most 6 hashtags.",
    `platform must be one of: ${PLATFORMS.join(" | ")}.`,
    `format must be one of: ${CONTENT_TYPES.join(" | ")}.`,
    'Exact shape: {"topics":[{"date":"YYYY-MM-DD","topic":"","pillar":"","platform":"instagram","format":"Static post","brief":"","caption":"","hashtags":["#tag"]}]}',
  ]
    .filter(Boolean)
    .join(" ");
  const user = [
    `Request: ${req.prompt || "Build a topic-wise social media calendar."}`,
    `Industry: ${req.industry || "general"}.`,
    req.region ? `Country/region: ${req.region}.` : "",
    req.theme ? `Theme: ${req.theme}.` : "",
    req.client_name ? `Client: ${req.client_name}.` : "",
    `Plan topics ${scopeText}.`,
    `At most ${req.maxTopics} topics, sorted by date.`,
    "Return topics, briefs and draft captions. Do not return event records.",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

type RawTopic = Partial<Record<"date" | "start_date" | "topic" | "name" | "title" | "pillar" | "category" | "platform" | "format" | "content_format" | "brief" | "angle" | "description" | "caption" | "body" | "hashtags", unknown>> | null;

/** Strict validation of the AI's topic plan. Anything that fails gets a human-readable reason. */
export function validateTopics(
  raw: unknown,
  ctx: { scope: Scope; existing: { date: string; topic: string; platform?: string }[]; maxTopics: number },
): { accepted: TopicProposal[]; rejected: Rejected[] } {
  const list = Array.isArray(raw) ? raw : (raw as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) return { accepted: [], rejected: [{ item: "AI answer", reason: "No topics list in the answer." }] };
  const w = scopeWindow(ctx.scope);
  const allowed = ctx.scope.scope === "dates" ? new Set(ctx.scope.dates) : null;
  const seen = new Set(ctx.existing.map((t) => `${t.date}|${t.topic.trim().toLowerCase()}|${(t.platform ?? "").toLowerCase()}`));
  const accepted: TopicProposal[] = [];
  const rejected: Rejected[] = [];

  for (const it of list as RawTopic[]) {
    const topic = str(it?.topic ?? it?.name ?? it?.title, 160);
    const date = str(it?.date ?? it?.start_date, 10);
    const label = topic || "(no topic)";
    if (!topic) { rejected.push({ item: label, reason: "Missing topic." }); continue; }
    if (!isValidISODate(date)) { rejected.push({ item: label, reason: `Invalid date "${date}".` }); continue; }
    if (date < w.start || date > w.end) { rejected.push({ item: label, reason: `Date ${date} is outside the requested period.` }); continue; }
    if (allowed && !allowed.has(date)) { rejected.push({ item: label, reason: `Date ${date} was not one of the selected dates.` }); continue; }
    const platform = normalizePlatform(it?.platform);
    if (!platform) { rejected.push({ item: label, reason: "Missing platform." }); continue; }
    const k = `${date}|${topic.toLowerCase()}|${platform}`;
    if (seen.has(k)) { rejected.push({ item: label, reason: "Duplicate of a topic already listed for this date and platform." }); continue; }
    if (accepted.length >= ctx.maxTopics) { rejected.push({ item: label, reason: `Over the limit of ${ctx.maxTopics} topics.` }); continue; }
    seen.add(k);
    const tags = Array.isArray(it?.hashtags)
      ? (it.hashtags as unknown[]).map((h) => str(h, 60).replace(/\s+/g, "")).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 10)
      : [];
    accepted.push({
      key: k,
      date,
      topic,
      pillar: str(it?.pillar ?? it?.category, 80) || "General",
      platform,
      format: normalizeFormat(it?.format ?? it?.content_format),
      brief: str(it?.brief ?? it?.angle ?? it?.description, 400),
      caption: str(it?.caption ?? it?.body, 1200),
      hashtags: tags,
      selected: true,
    });
  }
  accepted.sort((a, b) => a.date.localeCompare(b.date) || a.topic.localeCompare(b.topic) || a.platform.localeCompare(b.platform));
  return { accepted, rejected };
}

/** Deterministic answer for the built-in Test provider: good topics plus deliberately bad items. */
export function mockTopicResponse(req: ContentPlanRequest): string {
  const w = scopeWindow(req.scope);
  const field = req.industry || "General";
  const topics: { date: string; [k: string]: unknown }[] = [];
  const startY = Number(w.start.slice(0, 4));
  const endY = Number(w.end.slice(0, 4));
  for (let y = startY; y <= endY; y++) {
    for (let m = 1; m <= 12; m++) {
      const mm = pad(m);
      for (const [day, topic, pillar, format] of [
        ["05", `${field} education carousel`, "Education", "Carousel"],
        ["12", `${field} behind-the-scenes reel`, "Trust", "Reel"],
        ["20", `${field} audience Q&A`, "Engagement", "Story"],
      ] as const) {
        if (topics.length >= req.maxTopics) break;
        const date = `${y}-${mm}-${day}`;
        if (date >= w.start && date <= w.end && (req.scope.scope !== "dates" || req.scope.dates.includes(date))) {
          topics.push({
            date,
            topic,
            pillar,
            platform: format === "Reel" ? "instagram" : format === "Story" ? "instagram" : "linkedin",
            format,
            brief: `A short ${pillar.toLowerCase()} angle for ${field}.`,
            caption: `${topic}: a practical, friendly caption the team can edit.`,
            hashtags: ["#test", `#${field.replace(/\W+/g, "")}`],
          });
        }
      }
      if (topics.length >= req.maxTopics) break;
    }
    if (topics.length >= req.maxTopics) break;
  }
  topics.push({ date: "1999-01-01", topic: "Outside the period", platform: "instagram", format: "Post" });
  topics.push({ date: `${startY}-01-10`, topic: "", platform: "instagram", format: "Post" });
  if (topics[0]) topics.push({ ...topics[0] });
  return JSON.stringify({ topics: topics.slice(0, Math.max(1, req.maxTopics) + 3) });
}
