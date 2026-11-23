import { describe, expect, it } from "vitest";
import { addMonths, format } from "date-fns";
import { formatMDY, formatTime12, initialScheduleDate, isValidISODate, scopeRange, zonedToUtc } from "@/lib/dates";
import { todayIn } from "@/lib/hooks";
import { redact } from "@/lib/ai.server";
import { parseJSONLoose } from "@/lib/ai/client";

describe("planner date rules", () => {
  it("shows tile dates as month/day/year", () => {
    expect(formatMDY("2027-02-04")).toBe("02/04/2027");
  });

  it("a full-year plan covers Jan 1 to Dec 31", () => {
    expect(scopeRange({ scope: "year", year: 2027 })).toEqual({ start: "2027-01-01", end: "2027-12-31" });
  });

  it("a month plan ends on the month's last day (leap February)", () => {
    expect(scopeRange({ scope: "month", year: 2028, month: 2 })).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("specific-date plans span the earliest to latest picked date", () => {
    expect(scopeRange({ scope: "dates", dates: ["2027-05-10", "2027-03-01"] })).toEqual({ start: "2027-03-01", end: "2027-05-10" });
  });

  it("rejects impossible dates from the AI", () => {
    expect(isValidISODate("2027-02-30")).toBe(false);
    expect(isValidISODate("2027-02-28")).toBe(true);
  });

  it("formats posting times in 12-hour clock", () => {
    expect(formatTime12("14:30:00")).toBe("2:30 PM");
    expect(formatTime12("00:05")).toBe("12:05 AM");
  });
});

describe("scheduling time zones", () => {
  it("10:00 in India is 04:30 UTC", () => {
    expect(zonedToUtc("2027-02-04", "10:00", "Asia/Kolkata").toISOString()).toBe("2027-02-04T04:30:00.000Z");
  });

  it("respects daylight saving in New York (summer vs winter)", () => {
    expect(zonedToUtc("2027-07-01", "09:00", "America/New_York").toISOString()).toBe("2027-07-01T13:00:00.000Z");
    expect(zonedToUtc("2027-01-15", "09:00", "America/New_York").toISOString()).toBe("2027-01-15T14:00:00.000Z");
  });
});

describe("provider safety", () => {
  it("masks API keys in error text", () => {
    const out = redact("bad key sk-abcdef1234567890XYZ in request", "sk-abcdef1234567890XYZ");
    expect(out).not.toContain("1234567890XYZ");
  });

  it("reads JSON even when wrapped in a code fence", () => {
    expect(parseJSONLoose('Here:\n```json\n{"events":[{"date":"2027-01-01"}]}\n```')).toEqual({ events: [{ date: "2027-01-01" }] });
  });
});

describe("today follows the real clock", () => {
  it("formats today in the calendar's time zone", () => {
    expect(todayIn("UTC", new Date("2026-11-20T23:30:00Z"))).toBe("2026-11-20");
  });

  it("a date can be tomorrow in a forward time zone", () => {
    // 2026-11-20 23:30 UTC is already 2026-11-21 in Kolkata (+05:30).
    expect(todayIn("Asia/Kolkata", new Date("2026-11-20T23:30:00Z"))).toBe("2026-11-21");
  });
});

describe("schedule opens on the current year", () => {
  const today = "2026-11-20";

  it("a brand-new calendar with no events opens on the current month", () => {
    const start = initialScheduleDate(today, []);
    expect(start).toBe(today);
    expect(start.slice(0, 4)).toBe("2026"); // the current year, not a hard-coded one
  });

  it("an empty focus date is ignored (no invalid date)", () => {
    expect(initialScheduleDate(today, [], "")).toBe(today);
  });

  it("jumps to the first event today-or-later", () => {
    expect(initialScheduleDate(today, ["2025-03-01", "2027-02-04", "2027-08-09"])).toBe("2027-02-04");
  });

  it("falls back to the earliest event when every event is in the past", () => {
    expect(initialScheduleDate(today, ["2024-05-01", "2025-01-09"])).toBe("2024-05-01");
  });

  it("an explicit focus date always wins", () => {
    expect(initialScheduleDate(today, ["2027-02-04"], "2026-12-25")).toBe("2026-12-25");
  });

  it("the shown grid is three consecutive months starting at the open month", () => {
    const month = new Date(`${initialScheduleDate(today, [])}T00:00:00`);
    const shown = [0, 1, 2].map((i) => format(addMonths(month, i), "yyyy-MM"));
    expect(shown).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});
