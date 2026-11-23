import { describe, expect, it } from "vitest";
import { buildEventPrompt, effectiveTime, filterAndSort, isLeapYear, mockEventResponse, parseModelJson, salvageTruncatedEvents, scopeWindow, toCSV, validateProposals, withCurrent, CONTENT_TYPES, INDUSTRIES, type PlanRequest } from "@/lib/planner";
import { assertPublicHttps } from "@/lib/ai.server";

const req = (scope: PlanRequest["scope"]): PlanRequest => ({ prompt: "", scope, industry: "Medical", region: "India", theme: "", maxEvents: 100 });

describe("request scopes", () => {
  it("a week is 7 days starting on the chosen date", () => {
    expect(scopeWindow({ scope: "week", start: "2027-12-29" })).toEqual({ start: "2027-12-29", end: "2028-01-04" });
  });
  it("one day covers only that day", () => {
    expect(scopeWindow({ scope: "date", date: "2027-04-07" })).toEqual({ start: "2027-04-07", end: "2027-04-07" });
  });
  it("February has 29 days in a leap year and 28 otherwise", () => {
    expect(scopeWindow({ scope: "month", year: 2028, month: 2 }).end).toBe("2028-02-29");
    expect(scopeWindow({ scope: "month", year: 2027, month: 2 }).end).toBe("2027-02-28");
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
});

describe("AI answer validation", () => {
  it("rejects out-of-period, impossible and duplicate dates with reasons", () => {
    const scope = { scope: "year", year: 2028 } as const;
    const { accepted, rejected } = validateProposals(JSON.parse(mockEventResponse(req(scope))), { scope, existing: [], maxEvents: 100 });
    // 12 months x 3 events + leap day = 37
    expect(accepted.length).toBe(37);
    expect(accepted.some((p) => p.start_date === "2028-02-29")).toBe(true);
    const reasons = rejected.map((r) => r.reason).join(" | ");
    expect(reasons).toContain("outside the requested period");
    expect(reasons).toContain("Invalid date");
    expect(reasons).toContain("Duplicate");
  });
  it("skips events already saved in the calendar", () => {
    const scope = { scope: "month", year: 2027, month: 3 } as const;
    const { accepted, rejected } = validateProposals(
      { events: [{ name: "World Hearing Day", start_date: "2027-03-03" }] },
      { scope, existing: [{ start_date: "2027-03-03", name: "world hearing day" }], maxEvents: 10 },
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toContain("Duplicate");
  });
  it("only accepts selected dates when planning specific dates", () => {
    const scope = { scope: "dates" as const, dates: ["2027-05-01", "2027-05-09"] };
    const { accepted } = validateProposals({ events: [{ name: "A", start_date: "2027-05-01" }, { name: "B", start_date: "2027-05-05" }] }, { scope, existing: [], maxEvents: 10 });
    expect(accepted.map((a) => a.name)).toEqual(["A"]);
  });
  it("never trusts unknown event kinds as official and drops non-https sources", () => {
    const scope = { scope: "year", year: 2027 } as const;
    const { accepted } = validateProposals({ events: [{ name: "X", start_date: "2027-01-02", event_kind: "official?", source_url: "http://x.org" }] }, { scope, existing: [], maxEvents: 10 });
    expect(accepted[0]?.event_kind).toBe("ai_suggestion");
    expect(accepted[0]?.source_url).toBe("");
  });
});

describe("posting time rules", () => {
  it("an individual date override always wins over the calendar default", () => {
    expect(effectiveTime({ time_override: "18:30" }, { default_time: "09:00" })).toBe("18:30");
    expect(effectiveTime({ time_override: null }, { default_time: "09:00" })).toBe("09:00");
  });
});

describe("list view", () => {
  const ev = (id: string, name: string, d: string, cat = "Other", st = "pending_review") => ({ id, name, short_description: "", category: cat, start_date: d, approval_status: st, publish_status: "not_scheduled" });
  const list = [ev("1", "Beta", "2027-03-01"), ev("2", "Alpha", "2027-01-01", "Holiday", "approved"), ev("3", "Gamma", "2027-02-01")];
  const base = { q: "", category: "all", status: "all", from: "", to: "", sort: "date_asc" as const };
  it("sorts by date and by name", () => {
    expect(filterAndSort(list, base).map((e) => e.id)).toEqual(["2", "3", "1"]);
    expect(filterAndSort(list, { ...base, sort: "name_desc" }).map((e) => e.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  });
  it("filters by category, status and date range", () => {
    expect(filterAndSort(list, { ...base, category: "Holiday" }).map((e) => e.id)).toEqual(["2"]);
    expect(filterAndSort(list, { ...base, status: "approved" }).map((e) => e.id)).toEqual(["2"]);
    expect(filterAndSort(list, { ...base, from: "2027-02-01", to: "2027-02-28" }).map((e) => e.id)).toEqual(["3"]);
  });
  it("CSV export quotes commas", () => {
    expect(toCSV([{ a: "x,y", b: 1 }])).toBe('a,b\n"x,y",1');
  });
});

describe("hosted AI relay safety", () => {
  it("refuses private network and non-https addresses", () => {
    expect(() => assertPublicHttps("http://api.openai.com/v1")).toThrow();
    expect(() => assertPublicHttps("https://127.0.0.1:8765")).toThrow();
    expect(() => assertPublicHttps("https://192.168.1.4/v1")).toThrow();
    expect(() => assertPublicHttps("https://api.openai.com/v1")).not.toThrow();
  });
});

describe("strict JSON from the AI", () => {
  it("accepts a plain JSON object", () => {
    expect(parseModelJson('{"events":[]}')).toEqual({ ok: true, value: { events: [] } });
  });

  it("accepts a single ```json fence", () => {
    const r = parseModelJson('```json\n{"events":[{"name":"X"}]}\n```');
    expect(r.ok && (r.value as { events: unknown[] }).events.length).toBe(1);
  });

  it("rejects prose wrapped around the JSON (no silent salvage)", () => {
    const r = parseModelJson('Sure! Here is your calendar:\n{"events":[]}');
    expect(r).toMatchObject({ ok: false, reason: "not_json" });
  });

  it("reports a cut-off answer as truncated", () => {
    expect(parseModelJson('{"events":[{"name":"X"', "length")).toMatchObject({ ok: false, reason: "truncated" });
    expect(parseModelJson('{"events":[{"name":"X"')).toMatchObject({ ok: false, reason: "truncated" });
  });

  it("reports broken syntax as malformed", () => {
    expect(parseModelJson('{"events":[{"name": }]}')).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("reports an empty answer", () => {
    expect(parseModelJson("   ")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("the prompt tells the model to return one bare JSON object", () => {
    const { system } = buildEventPrompt(req({ scope: "year", year: 2027 }));
    expect(system).toMatch(/single JSON object/i);
    expect(system).toMatch(/do not wrap it in markdown/i);
  });

  it("names the client when the request is client-specific", () => {
    const base = req({ scope: "month", year: 2026, month: 11 });
    const { user } = buildEventPrompt({ ...base, client_id: "c1", client_name: "Acme" });
    expect(user).toMatch(/Client: Acme\./);
  });

  it("keeps the prompt compact enough for a small output limit", () => {
    const { system } = buildEventPrompt(req({ scope: "month", year: 2026, month: 11 }));
    const shape = system.slice(system.indexOf("Exact shape:"));
    expect(system).toMatch(/start_date must fall inside the requested period/i);
    expect(system).toMatch(/short_description under 90 characters/i);
    expect(shape).not.toMatch(/image_prompt|video_prompt/);
  });

  it("recovers complete events from a cut-off answer", () => {
    const first = '{"name":"World Stroke Day","start_date":"2026-10-29","hashtags":["#stroke"]}';
    const second = '{"name":"National Patient Transport Week","start_date":"2026-11-08"}';
    const text = `{"events":[${first},${second},{"name":"Incomplete","start_date":"2026-11-09`;
    expect(salvageTruncatedEvents(text)).toEqual([JSON.parse(first), JSON.parse(second)]);
  });

  it("drops an event cut off inside a string", () => {
    const first = '{"name":"World Stroke Day","start_date":"2026-10-29"}';
    const text = `{"events":[${first},{"name":"Broken","hashtags":["#a","#b`;
    expect(salvageTruncatedEvents(text)).toEqual([JSON.parse(first)]);
  });

  it("returns no events when there is no events array", () => {
    expect(salvageTruncatedEvents('{"error":"not an events answer"')).toEqual([]);
  });
});

describe("dropdown option lists", () => {
  it("keeps a stored custom value selectable without duplicating presets", () => {
    const custom = withCurrent(INDUSTRIES, "Aerospace");
    expect(custom[0]).toBe("Aerospace");
    expect(custom).toHaveLength(INDUSTRIES.length + 1);
    expect(withCurrent(CONTENT_TYPES, "Reel")).toEqual([...CONTENT_TYPES]);
  });
});
