import { describe, expect, it } from "vitest";
import { SCOPES, SCOPE_LABEL, builtinEventsFor, defaultScopeFor, eventCode, scopeMatches } from "@/lib/global-calendar";

describe("stable event codes", () => {
  it("builds SCOPE-SLUG-MMDD codes", () => {
    expect(eventCode("IN", "India Independence Day", "2026-08-15")).toBe("IN-INDIA-INDEPENDENCE-DAY-0815");
    expect(eventCode("US", "Thanksgiving", "2026-11-26")).toBe("US-THANKSGIVING-1126");
  });
  it("is the same code for the same observance every year", () => {
    const a = eventCode("GLOBAL", "World Health Day", "2026-04-07");
    const b = eventCode("GLOBAL", "World Health Day", "2030-04-07");
    expect(a.slice(0, -4)).toBe(b.slice(0, -4));
    expect(a.endsWith("0407")).toBe(true);
    expect(b.endsWith("0407")).toBe(true);
  });
  it("ignores punctuation and accents when slugging", () => {
    expect(eventCode("GLOBAL", "New Year's Eve!", "2026-12-31")).toBe("GLOBAL-NEW-YEAR-S-EVE-1231");
  });
});

describe("region scopes", () => {
  it("a client sees worldwide events plus its own region", () => {
    expect(scopeMatches("GLOBAL", "IN")).toBe(true);
    expect(scopeMatches("IN", "IN")).toBe(true);
    expect(scopeMatches("US", "IN")).toBe(false);
  });
  it("guesses a scope from the time zone or region text", () => {
    expect(defaultScopeFor("Asia/Kolkata")).toBe("IN");
    expect(defaultScopeFor("America/New_York")).toBe("US");
    expect(defaultScopeFor("Europe/London")).toBe("GB");
    expect(defaultScopeFor("UTC", "United Arab Emirates")).toBe("AE");
    expect(defaultScopeFor("UTC", "")).toBe("GLOBAL");
  });
  it("every scope has a human label", () => {
    for (const s of SCOPES) expect(SCOPE_LABEL[s]).toBeTruthy();
  });
});

describe("built-in observances", () => {
  it("expands to dated rows with unique codes for a year", () => {
    const rows = builtinEventsFor(2026);
    expect(rows.length).toBeGreaterThan(15);
    const codes = new Set(rows.map((r) => r.event_code));
    expect(codes.size).toBe(rows.length);
    for (const r of rows) {
      expect(r.start_date.startsWith("2026-")).toBe(true);
      expect(r.start_date).toBe(r.end_date);
      expect(r.event_kind).toBe("official_observance");
    }
  });
  it("includes India Independence Day and US Independence Day with distinct codes", () => {
    const rows = builtinEventsFor(2026);
    const inDay = rows.find((r) => r.name === "India Independence Day");
    const usDay = rows.find((r) => r.name === "US Independence Day");
    expect(inDay?.start_date).toBe("2026-08-15");
    expect(usDay?.start_date).toBe("2026-07-04");
    expect(inDay?.event_code).not.toBe(usDay?.event_code);
  });
});
