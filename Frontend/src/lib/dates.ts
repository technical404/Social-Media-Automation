// Pure date helpers shared by the planner, scheduler and server functions.

/** "2027-02-04" -> "02/04/2027" (month/day/year) */
export function formatMDY(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "14:30:00" | "14:30" -> "2:30 PM" */
export function formatTime12(t: string): string {
  const [hh = 0, mm = 0] = t.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${pad(mm)} ${suffix}`;
}

export type PlanScope =
  | { scope: "year"; year: number }
  | { scope: "month"; year: number; month: number } // month 1-12
  | { scope: "range"; start: string; end: string }
  | { scope: "dates"; dates: string[] };

/** Inclusive date window for a planning scope. */
export function scopeRange(s: PlanScope): { start: string; end: string } {
  switch (s.scope) {
    case "year":
      return { start: `${s.year}-01-01`, end: `${s.year}-12-31` };
    case "month": {
      const last = new Date(Date.UTC(s.year, s.month, 0)).getUTCDate();
      return { start: `${s.year}-${pad(s.month)}-01`, end: `${s.year}-${pad(s.month)}-${pad(last)}` };
    }
    case "range":
      return s.start <= s.end ? { start: s.start, end: s.end } : { start: s.end, end: s.start };
    case "dates": {
      const sorted = [...s.dates].sort();
      return { start: sorted[0] ?? "", end: sorted[sorted.length - 1] ?? "" };
    }
  }
}

export function isValidISODate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The date the schedule should open on.
 * Priority: an explicit focus date, else the first event that is today-or-later,
 * else the earliest event, else today — so a brand-new calendar always shows the
 * current month/year instead of drifting to the epoch.
 */
export function initialScheduleDate(today: string, eventDates: string[], focusDate?: string | null): string {
  return focusDate || eventDates.find((d) => d >= today) || eventDates[0] || today;
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUTC - utcMs;
}

/**
 * Convert a wall-clock date + time in an IANA time zone to a UTC Date.
 * Daylight-saving aware (re-checks the offset at the resulting instant).
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = wall - tzOffsetMs(wall, timeZone);
  const second = tzOffsetMs(utc, timeZone);
  utc = wall - second;
  return new Date(utc);
}

/** Format a UTC instant in a time zone as "MM/DD/YYYY, h:mm AM". */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** ISO date (YYYY-MM-DD) of a UTC instant as seen in a time zone. */
export function isoDateInZone(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return p;
}

export const TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];
