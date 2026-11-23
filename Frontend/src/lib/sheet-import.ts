// Spreadsheet import: header mapping, value normalisation and row validation.
// Pure functions only — the file reading (xlsx) happens in the dialog so this stays testable.

import { isValidISODate, pad } from "./dates";
import { CATEGORIES } from "./planner";

export const MAX_IMPORT_ROWS = 2000;

export type ImportField =
  | "name"
  | "start_date"
  | "end_date"
  | "time"
  | "category"
  | "content_type"
  | "platforms"
  | "short_description"
  | "detailed_description"
  | "campaign_topic"
  | "hashtags"
  | "importance"
  | "source_url"
  | "ignore";

type RealField = Exclude<ImportField, "ignore">;

export const FIELD_LABELS: Record<ImportField, string> = {
  name: "Topic / name",
  start_date: "Date",
  end_date: "End date",
  time: "Posting time",
  category: "Category",
  content_type: "Content type",
  platforms: "Platforms",
  short_description: "Description",
  detailed_description: "Detailed description",
  campaign_topic: "Campaign topic",
  hashtags: "Hashtags",
  importance: "Importance",
  source_url: "Source link",
  ignore: "Ignore",
};

const HEADER_ALIASES: Record<RealField, string[]> = {
  name: ["name", "topic", "event", "eventname", "eventtitle", "title", "occasion", "occasionname", "subject", "campaignname", "postname", "posttitle", "festival", "festivalname", "contentname"],
  start_date: ["date", "startdate", "eventdate", "postdate", "publishdate", "scheduledate", "dateofpost", "day"],
  end_date: ["enddate", "todate", "until", "dateend"],
  time: ["time", "postingtime", "posttime", "publishtime", "scheduledtime", "timeoverride", "hour"],
  category: ["category", "eventcategory", "observance", "occasiontype"],
  content_type: ["contenttype", "contentformat", "format", "type", "assettype", "mediatype", "posttype", "creative", "contentkind"],
  platforms: ["platform", "platforms", "channel", "channels", "social", "socialmedia", "network", "networks", "where"],
  short_description: ["shortdescription", "description", "summary", "caption", "idea", "content", "hook", "brief", "postcopy", "copy"],
  detailed_description: ["detaileddescription", "longdescription", "notes", "details", "script", "body"],
  campaign_topic: ["campaigntopic", "campaign", "theme", "pillar"],
  hashtags: ["hashtags", "hashtag", "tags", "tag"],
  importance: ["importance", "priority", "weight", "significance"],
  source_url: ["sourceurl", "source", "url", "link", "reference", "sourcelink"],
};

const REAL_FIELDS = Object.keys(HEADER_ALIASES) as RealField[];

/** Lowercase, strip accents and punctuation so header aliases match reliably. */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Map each spreadsheet column to an import field. First matching column per field wins. */
export function autoMapColumns(headers: string[]): ImportField[] {
  const used = new Set<RealField>();
  return headers.map((header) => {
    const key = normalizeHeader(header);
    if (!key) return "ignore";
    for (const field of REAL_FIELDS) {
      if (used.has(field)) continue;
      if (HEADER_ALIASES[field].includes(key)) {
        used.add(field);
        return field;
      }
    }
    if (!used.has("start_date") && (key.endsWith("date") || key.endsWith("dates"))) {
      used.add("start_date");
      return "start_date";
    }
    if (!used.has("name") && key.includes("topic")) {
      used.add("name");
      return "name";
    }
    return "ignore";
  });
}

/** Best guess at the header row within the first few rows (sheets often have a title above it). */
export function findHeaderRow(matrix: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? [];
    const cells = row.map((cell) => cellToText(cell)).filter(Boolean);
    if (!cells.length) continue;
    const recognized = autoMapColumns(cells).filter((field) => field !== "ignore").length;
    const score = recognized * 10 + cells.length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return dateToIso(value) || value.toISOString().slice(0, 10);
  if (typeof value === "object") return "";
  return String(value).trim();
}

function buildIso(year: number, month: number, day: number): string {
  const y = year < 100 ? (year <= 69 ? 2000 + year : 1900 + year) : year;
  if (y < 1900 || y > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const iso = `${y}-${pad(month)}-${pad(day)}`;
  return isValidISODate(iso) ? iso : "";
}

function dateToIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return buildIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Excel serial day number -> ISO date (epoch 1899-12-30, which accounts for the 1900 leap bug). */
export function excelSerialToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 200000) return "";
  const wholeDays = Math.floor(serial);
  const d = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
  return buildIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function monthFromName(value: string): number {
  return MONTHS[value.toLowerCase().replace(/\./g, "")] ?? 0;
}

/**
 * Normalise many common date spellings to YYYY-MM-DD.
 * `monthFirst` only matters for ambiguous numeric dates such as 01/02/2026.
 */
export function normalizeDate(value: unknown, monthFirst = false): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return dateToIso(value);
  if (typeof value === "number" && Number.isFinite(value)) return excelSerialToIso(value);

  const s = String(value)
    .trim()
    .replace(/^'/, "")
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (!s) return "";

  // 2026-12-01, 2026/12/01, 2026-12-01T10:00:00Z
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return buildIso(Number(m[1]), Number(m[2]), Number(m[3]));

  // 01/02/2026, 1-2-26, 2026 style handled above
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ].*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    let day: number;
    let month: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else if (monthFirst) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    return buildIso(y, month, day);
  }

  // 1-Feb-2026 / 1 Feb 2026
  m = s.match(/^(\d{1,2})[\s\-./]+([A-Za-z]{3,})[\s\-./,]+(\d{2,4})$/);
  if (m) {
    const month = monthFromName(m[2] ?? "");
    if (month) return buildIso(Number(m[3]), month, Number(m[1]));
  }

  // Feb 1, 2026 / February 1 2026
  m = s.match(/^([A-Za-z]{3,})[\s\-./]+(\d{1,2})[\s\-./,]+(\d{2,4})$/);
  if (m) {
    const month = monthFromName(m[1] ?? "");
    if (month) return buildIso(Number(m[3]), month, Number(m[2]));
  }

  // Last resort for strings that clearly contain a year/month name (never for bare numbers).
  if (/\d{4}/.test(s) || /[A-Za-z]{3}/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return dateToIso(parsed);
  }
  return "";
}

/** "10:00 AM" | "22:15" | Excel fraction 0.4167 | Date -> HH:MM (24h), or "" if not recognised. */
export function normalizeTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    let fraction = value >= 1 ? value - Math.floor(value) : value;
    if (value >= 1 && fraction === 0) fraction = 0;
    if (fraction <= 0 || fraction >= 1) return "";
    const minutes = Math.round(fraction * 1440) % 1440;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  const s = String(value).trim().toUpperCase();
  if (!s) return "";

  let m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)$/);
  if (m) {
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return "";
    hour = (hour % 12) + (m[3] === "PM" ? 12 : 0);
    return `${pad(hour)}:${pad(minute)}`;
  }

  m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : "";
  }

  m = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : "";
  }
  return "";
}

export const KNOWN_PLATFORMS = ["instagram", "facebook", "linkedin", "x", "youtube", "tiktok", "pinterest"] as const;

const PLATFORM_ALIAS: Record<string, string> = {
  ig: "instagram", insta: "instagram", instagram: "instagram",
  fb: "facebook", facebook: "facebook", meta: "facebook",
  li: "linkedin", linkedin: "linkedin",
  x: "x", twitter: "x", tweet: "x", xcom: "x", twitterx: "x",
  yt: "youtube", youtube: "youtube",
  tiktok: "tiktok", tik: "tiktok", tok: "tiktok",
  pin: "pinterest", pinterest: "pinterest",
};

const PLATFORM_NOISE = new Set(["and", "social", "media", "platform", "platforms", "post", "posts", "all", "shorts", "reels", "video", "feed"]);

/** Split a platform-cell into canonical platform keys (unknown tokens are kept so the user sees them). */
export function normalizePlatforms(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String).join(",") : String(value ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,;/|&]+/)) {
    const key = normalizeHeader(token);
    if (!key || PLATFORM_NOISE.has(key)) continue;
    const platform = PLATFORM_ALIAS[key] ?? key;
    if (!seen.has(platform)) {
      seen.add(platform);
      out.push(platform);
    }
  }
  return out;
}

export function normalizeHashtags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const tag = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(`#${tag}`);
  }
  return out;
}

export function normalizeCategory(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "Other";
  const exact = CATEGORIES.find((category) => category.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const key = normalizeHeader(s);
  if (key.includes("month") && key.includes("awareness")) return "Awareness month";
  if (key.includes("week") && key.includes("awareness")) return "Awareness week";
  if (key.includes("awareness")) return "Awareness day";
  if (key.includes("holiday") || key.includes("festival")) return "Holiday";
  if (key.includes("industry") || key.includes("conference") || key.includes("trade") || key.includes("expo") || key.includes("summit")) return "Industry event";
  if (key.includes("campaign") || key.includes("idea")) return "Campaign idea";
  return "Other";
}

export function normalizeImportance(value: unknown): "low" | "medium" | "high" {
  const key = normalizeHeader(String(value ?? ""));
  if (["high", "hi", "h", "critical", "important", "urgent"].includes(key)) return "high";
  if (["low", "lo", "l", "minor"].includes(key)) return "low";
  return "medium";
}

const CONTENT_TYPE_ALIAS: Record<string, string> = {
  reel: "Reel", reels: "Reel", reelvideo: "Reel", video: "Video", shortvideo: "Short video", shorts: "Short video",
  story: "Story", stories: "Story", post: "Post", static: "Static post", staticpost: "Static post",
  carousel: "Carousel", image: "Image", photo: "Image", caption: "Caption", blog: "Blog",
  email: "Email", poll: "Poll", live: "Live", gif: "GIF",
};

export function normalizeContentType(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return CONTENT_TYPE_ALIAS[normalizeHeader(s)] ?? s;
}

export function normalizeSourceUrl(value: unknown): string {
  const s = String(value ?? "").trim();
  return /^https:\/\/\S+$/i.test(s) ? s : "";
}

export type ImportDraft = {
  key: string;
  name: string;
  start_date: string;
  end_date: string;
  time: string;
  time_raw: string;
  category: string;
  content_type: string;
  platform_text: string;
  platforms: string[];
  hashtag_text: string;
  hashtags: string[];
  short_description: string;
  detailed_description: string;
  campaign_topic: string;
  importance: "low" | "medium" | "high";
  source_raw: string;
  source_url: string;
  include: boolean;
};

export type DraftOptions = { monthFirst?: boolean; maxRows?: number };

/**
 * Convert a matrix (row 0 = headers) into editable drafts using the column mapping.
 * Completely blank rows are skipped.
 */
export function draftsFromMatrix(matrix: unknown[][], mapping: ImportField[], opts: DraftOptions = {}): ImportDraft[] {
  const monthFirst = opts.monthFirst ?? false;
  const maxRows = opts.maxRows ?? MAX_IMPORT_ROWS;
  const rows = matrix.slice(1, 1 + maxRows);
  const out: ImportDraft[] = [];

  rows.forEach((row, index) => {
    const anyMapped = mapping.some((field, column) => field !== "ignore" && cellToText(row[column]) !== "");
    if (!anyMapped) return;

    const value = (field: RealField): unknown => {
      const column = mapping.indexOf(field);
      return column === -1 ? undefined : row[column];
    };

    const startDate = normalizeDate(value("start_date"), monthFirst);
    const rawEnd = normalizeDate(value("end_date"), monthFirst);
    const endDate = !rawEnd || (startDate && rawEnd < startDate) ? startDate : rawEnd;
    const timeRaw = cellToText(value("time"));
    const sourceRaw = cellToText(value("source_url"));
    const hashtags = normalizeHashtags(value("hashtags"));

    out.push({
      key: `row-${index}`,
      name: cellToText(value("name")).trim(),
      start_date: startDate,
      end_date: endDate,
      time: normalizeTime(value("time")),
      time_raw: timeRaw,
      category: normalizeCategory(value("category")),
      content_type: normalizeContentType(value("content_type")),
      platform_text: cellToText(value("platforms")),
      platforms: normalizePlatforms(value("platforms")),
      hashtag_text: hashtags.join(" "),
      hashtags,
      short_description: cellToText(value("short_description")),
      detailed_description: cellToText(value("detailed_description")),
      campaign_topic: cellToText(value("campaign_topic")),
      importance: normalizeImportance(value("importance")),
      source_raw: sourceRaw,
      source_url: normalizeSourceUrl(sourceRaw),
      include: true,
    });
  });
  return out;
}

export type ImportProblem = { level: "error" | "warning"; message: string };
export type ImportCheck = { problems: ImportProblem[]; duplicate: boolean; canInclude: boolean };

/** Validate drafts against the calendar's existing events and against each other. */
export function validateDrafts(drafts: ImportDraft[], existingKeys: Set<string>): ImportCheck[] {
  const seen = new Set<string>();
  return drafts.map((draft) => {
    const problems: ImportProblem[] = [];
    const name = draft.name.trim();
    if (!name) problems.push({ level: "error", message: "Topic is required" });
    if (!isValidISODate(draft.start_date)) problems.push({ level: "error", message: "Pick a valid date (YYYY-MM-DD)" });
    if (draft.time_raw.trim() && !draft.time) problems.push({ level: "warning", message: "Time not recognised — the calendar default will be used" });
    if (draft.source_raw.trim() && !draft.source_url) problems.push({ level: "warning", message: "Source link ignored — only https:// links are kept" });
    if (isValidISODate(draft.start_date) && isValidISODate(draft.end_date) && draft.end_date < draft.start_date) {
      problems.push({ level: "warning", message: "End date is before the start date — using the start date" });
    }
    for (const platform of draft.platforms) {
      if (!(KNOWN_PLATFORMS as readonly string[]).includes(platform)) {
        problems.push({ level: "warning", message: `Check platform spelling: ${platform}` });
      }
    }

    let duplicate = false;
    if (name && isValidISODate(draft.start_date)) {
      const key = `${draft.start_date}|${name.toLowerCase()}`;
      if (existingKeys.has(key)) {
        duplicate = true;
        problems.push({ level: "warning", message: "Already in this calendar — skipped" });
      } else if (seen.has(key)) {
        duplicate = true;
        problems.push({ level: "warning", message: "Duplicate row in this sheet — skipped" });
      }
      seen.add(key);
    }

    return { problems, duplicate, canInclude: !problems.some((p) => p.level === "error") && !duplicate };
  });
}

export function existingKeySet(events: { start_date: string; name: string }[]): Set<string> {
  return new Set(events.map((event) => `${event.start_date}|${event.name.trim().toLowerCase()}`));
}

/** Build the event row that will be written to the database. */
export function toEventInput(draft: ImportDraft, scope = "GLOBAL") {
  const end = isValidISODate(draft.end_date) && draft.end_date >= draft.start_date ? draft.end_date : draft.start_date;
  return {
    name: draft.name.trim(),
    short_description: draft.short_description.trim(),
    detailed_description: draft.detailed_description.trim(),
    category: draft.category,
    start_date: draft.start_date,
    end_date: end,
    importance: draft.importance,
    event_kind: "custom" as const,
    source_url: draft.source_url,
    verification_status: draft.source_url ? "source_provided" : "unverified",
    campaign_topic: draft.campaign_topic.trim(),
    content_format: draft.content_type.trim(),
    time_override: draft.time || null,
    hashtags: draft.hashtags,
    platforms: draft.platforms,
    scope,
  };
}

/** Best default for ambiguous numeric dates based on the browser locale. */
export function localeUsesMonthFirst(locale: string): boolean {
  return /^en[-_](US|PH)\b/i.test(locale) || /^(ja|ko|zh)\b/i.test(locale);
}
