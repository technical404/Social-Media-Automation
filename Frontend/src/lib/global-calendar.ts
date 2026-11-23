// The Global Calendar's building blocks: region scopes, stable per-observance codes and a small
// curated set of fixed-date observances. Pure functions only — no database access here.

/** Region tags. A client calendar sees GLOBAL events plus its own scope's events. */
export const SCOPES = ["GLOBAL", "IN", "US", "GB", "AE", "CA", "AU", "SG"] as const;
export type Scope2 = (typeof SCOPES)[number];

export const SCOPE_LABEL: Record<string, string> = {
  GLOBAL: "Worldwide",
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  AE: "UAE / Gulf",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
};

/** A client sees worldwide events plus the ones tagged for its own region. */
export function scopeMatches(eventScope: string, calendarScope: string): boolean {
  return eventScope === "GLOBAL" || eventScope === calendarScope;
}

/** Best guess at a region scope from a time zone and/or free-text region. */
export function defaultScopeFor(timezone: string, region = ""): Scope2 {
  const s = `${timezone} ${region}`.toLowerCase();
  if (/kolkata|calcutta|india/.test(s)) return "IN";
  if (/america|united states|\busa?\b/.test(s)) return "US";
  if (/london|united kingdom|\buk\b|\bgb\b/.test(s)) return "GB";
  if (/dubai|gulf|muscat|riyadh|emirates|abu dhabi|\bae\b|\buae\b/.test(s)) return "AE";
  if (/toronto|vancouver|canada/.test(s)) return "CA";
  if (/sydney|melbourne|australia/.test(s)) return "AU";
  if (/singapore/.test(s)) return "SG";
  return "GLOBAL";
}

/** Stable code for an observance: SCOPE-SLUG-MMDD, e.g. IN-INDEPENDENCE-DAY-0815. */
export function eventCode(scope: string, name: string, date: string): string {
  const slug = name
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const mmdd = date.slice(5).replace("-", "");
  return `${scope}-${slug}-${mmdd}`;
}

export type Builtin = { name: string; scope: Scope2; month: number; day: number; category: string; note: string };

/**
 * Fixed-date observances only (they land on the same day every year, so one code works forever).
 * Moving feasts (Easter, Diwali, Thanksgiving…) are added through AI so they get the right date.
 */
export const BUILTIN_OBSERVANCES: Builtin[] = [
  { name: "New Year's Day", scope: "GLOBAL", month: 1, day: 1, category: "Holiday", note: "Start-of-year wishes and goals." },
  { name: "World Cancer Day", scope: "GLOBAL", month: 2, day: 4, category: "Awareness day", note: "Early detection and support." },
  { name: "Valentine's Day", scope: "GLOBAL", month: 2, day: 14, category: "Holiday", note: "Love, friendship and gratitude." },
  { name: "International Women's Day", scope: "GLOBAL", month: 3, day: 8, category: "Awareness day", note: "Women's achievements." },
  { name: "World TB Day", scope: "GLOBAL", month: 3, day: 24, category: "Awareness day", note: "Tuberculosis awareness." },
  { name: "World Health Day", scope: "GLOBAL", month: 4, day: 7, category: "Awareness day", note: "WHO founding day." },
  { name: "Ambedkar Jayanti", scope: "IN", month: 4, day: 14, category: "Holiday", note: "Birth anniversary of Dr B. R. Ambedkar." },
  { name: "Earth Day", scope: "GLOBAL", month: 4, day: 22, category: "Awareness day", note: "Environment and climate." },
  { name: "Labour Day", scope: "GLOBAL", month: 5, day: 1, category: "Holiday", note: "Workers' rights." },
  { name: "International Nurses Day", scope: "GLOBAL", month: 5, day: 12, category: "Awareness day", note: "Nursing contributions." },
  { name: "World No Tobacco Day", scope: "GLOBAL", month: 5, day: 31, category: "Awareness day", note: "Tobacco control." },
  { name: "World Environment Day", scope: "GLOBAL", month: 6, day: 5, category: "Awareness day", note: "Planet protection." },
  { name: "Juneteenth", scope: "US", month: 6, day: 19, category: "Holiday", note: "End of slavery in the US." },
  { name: "US Independence Day", scope: "US", month: 7, day: 4, category: "Holiday", note: "Fourth of July." },
  { name: "World Hepatitis Day", scope: "GLOBAL", month: 7, day: 28, category: "Awareness day", note: "Hepatitis awareness." },
  { name: "India Independence Day", scope: "IN", month: 8, day: 15, category: "Holiday", note: "15 August." },
  { name: "Teachers' Day (India)", scope: "IN", month: 9, day: 5, category: "Holiday", note: "Dr Radhakrishnan's birthday." },
  { name: "International Day of Peace", scope: "GLOBAL", month: 9, day: 21, category: "Awareness day", note: "Peace and non-violence." },
  { name: "World Heart Day", scope: "GLOBAL", month: 9, day: 29, category: "Awareness day", note: "Heart health." },
  { name: "Gandhi Jayanti", scope: "IN", month: 10, day: 2, category: "Holiday", note: "Mahatma Gandhi's birthday." },
  { name: "World Mental Health Day", scope: "GLOBAL", month: 10, day: 10, category: "Awareness day", note: "Mental well-being." },
  { name: "Halloween", scope: "GLOBAL", month: 10, day: 31, category: "Holiday", note: "Spooky season content." },
  { name: "Veterans Day", scope: "US", month: 11, day: 11, category: "Holiday", note: "Honouring US veterans." },
  { name: "Children's Day (India)", scope: "IN", month: 11, day: 14, category: "Holiday", note: "Nehru's birthday." },
  { name: "World Diabetes Day", scope: "GLOBAL", month: 11, day: 14, category: "Awareness day", note: "Diabetes awareness." },
  { name: "World AIDS Day", scope: "GLOBAL", month: 12, day: 1, category: "Awareness day", note: "HIV/AIDS awareness." },
  { name: "Christmas Day", scope: "GLOBAL", month: 12, day: 25, category: "Holiday", note: "Christmas." },
  { name: "New Year's Eve", scope: "GLOBAL", month: 12, day: 31, category: "Holiday", note: "Year-end recap." },
];

export type BuiltinEvent = {
  name: string;
  start_date: string;
  end_date: string;
  scope: Scope2;
  event_code: string;
  category: string;
  short_description: string;
  event_kind: "official_observance";
};

/** Expand the built-in list into dated rows for one year (deduplicated by code). */
export function builtinEventsFor(year: number): BuiltinEvent[] {
  const seen = new Set<string>();
  const out: BuiltinEvent[] = [];
  for (const b of BUILTIN_OBSERVANCES) {
    const mm = String(b.month).padStart(2, "0");
    const dd = String(b.day).padStart(2, "0");
    const date = `${year}-${mm}-${dd}`;
    const code = eventCode(b.scope, b.name, date);
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      name: b.name,
      start_date: date,
      end_date: date,
      scope: b.scope,
      event_code: code,
      category: b.category,
      short_description: b.note,
      event_kind: "official_observance",
    });
  }
  return out;
}
