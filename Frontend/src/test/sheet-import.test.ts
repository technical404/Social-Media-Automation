import { describe, expect, it } from "vitest";
import {
  autoMapColumns,
  cellToText,
  draftsFromMatrix,
  excelSerialToIso,
  existingKeySet,
  findHeaderRow,
  localeUsesMonthFirst,
  normalizeCategory,
  normalizeDate,
  normalizeHashtags,
  normalizeImportance,
  normalizePlatforms,
  normalizeTime,
  normalizeSourceUrl,
  toEventInput,
  validateDrafts,
} from "@/lib/sheet-import";

describe("column mapping", () => {
  it("recognises the common content-planner headers", () => {
    expect(autoMapColumns(["Topic", "Date", "Content Type", "Platform", "Category", "Posting Time", "Description", "Hashtags"])).toEqual([
      "name",
      "start_date",
      "content_type",
      "platforms",
      "category",
      "time",
      "short_description",
      "hashtags",
    ]);
  });

  it("maps only one column to each field", () => {
    expect(autoMapColumns(["Topic", "Name", "Date", "Start Date"])).toEqual(["name", "ignore", "start_date", "ignore"]);
  });

  it("recognises real sheet headers like Festival Name and OCS Dates", () => {
    expect(autoMapColumns(["Start Date", "Festival Name", "Arogyam"])).toEqual(["start_date", "name", "ignore"]);
    expect(autoMapColumns(["OCS Dates", "Festival Name"])).toEqual(["start_date", "name"]);
  });

  it("finds the header row below a title row", () => {
    const matrix = [["Content Planner 2027"], [], ["Topic", "Date", "Platform"], ["World AIDS Day", "2027-12-01", "instagram"]];
    expect(findHeaderRow(matrix)).toBe(2);
  });
});

describe("date normalisation", () => {
  it("reads ISO and locale-style numeric dates", () => {
    expect(normalizeDate("2026-12-01")).toBe("2026-12-01");
    expect(normalizeDate("01/12/2026", false)).toBe("2026-12-01");
    expect(normalizeDate("01/12/2026", true)).toBe("2026-01-12");
    expect(normalizeDate("25/12/2026", false)).toBe("2026-12-25");
    expect(normalizeDate("12/25/2026", false)).toBe("2026-12-25");
  });

  it("reads month names and ordinals", () => {
    expect(normalizeDate("1 Feb 2026")).toBe("2026-02-01");
    expect(normalizeDate("February 1, 2026")).toBe("2026-02-01");
    expect(normalizeDate("1st March 2027")).toBe("2027-03-01");
  });

  it("reads Excel serials and Date objects", () => {
    expect(excelSerialToIso(25569)).toBe("1970-01-01");
    expect(excelSerialToIso(46023)).toBe("2026-01-01");
    expect(excelSerialToIso(46054)).toBe("2026-02-01");
    expect(normalizeDate(46082)).toBe("2026-03-01");
    expect(normalizeDate(25569)).toBe("1970-01-01");
    expect(normalizeDate(new Date(2026, 11, 1))).toBe("2026-12-01");
  });

  it("rejects impossible or empty dates", () => {
    expect(normalizeDate("2026-02-30")).toBe("");
    expect(normalizeDate("not a date")).toBe("");
    expect(normalizeDate("")).toBe("");
  });
});

describe("time normalisation", () => {
  it("handles 12h, 24h, fractions and Dates", () => {
    expect(normalizeTime("10:00 AM")).toBe("10:00");
    expect(normalizeTime("10:00 PM")).toBe("22:00");
    expect(normalizeTime("12:00 AM")).toBe("00:00");
    expect(normalizeTime("12:30 PM")).toBe("12:30");
    expect(normalizeTime("14:05")).toBe("14:05");
    expect(normalizeTime(0.5)).toBe("12:00");
    expect(normalizeTime(0.4166666667)).toBe("10:00");
    expect(normalizeTime(new Date(2026, 11, 1, 9, 30))).toBe("09:30");
  });

  it("rejects nonsense times", () => {
    expect(normalizeTime("25:00")).toBe("");
    expect(normalizeTime("")).toBe("");
  });
});

describe("platform, hashtag, category and importance normalisation", () => {
  it("maps platform aliases and ignores noise", () => {
    expect(normalizePlatforms("ig, Insta, Facebook")).toEqual(["instagram", "facebook"]);
    expect(normalizePlatforms("X (Twitter)")).toEqual(["x"]);
    expect(normalizePlatforms("YouTube Shorts")).toEqual(["youtube"]);
    expect(normalizePlatforms("Instagram, LinkedIn")).toEqual(["instagram", "linkedin"]);
    expect(normalizePlatforms("instgram")).toEqual(["instgram"]);
  });

  it("normalises hashtags", () => {
    expect(normalizeHashtags("#Health #health, awareness")).toEqual(["#Health", "#awareness"]);
  });

  it("normalises categories and importance", () => {
    expect(normalizeCategory("awareness week")).toBe("Awareness week");
    expect(normalizeCategory("public holiday")).toBe("Holiday");
    expect(normalizeCategory("conference")).toBe("Industry event");
    expect(normalizeCategory("")).toBe("Other");
    expect(normalizeImportance("HIGH")).toBe("high");
    expect(normalizeImportance("minor")).toBe("low");
    expect(normalizeImportance("")).toBe("medium");
  });

  it("keeps only https source links", () => {
    expect(normalizeSourceUrl("https://example.com/page")).toBe("https://example.com/page");
    expect(normalizeSourceUrl("http://example.com")).toBe("");
  });

  it("uses the locale to default ambiguous dates", () => {
    expect(localeUsesMonthFirst("en-US")).toBe(true);
    expect(localeUsesMonthFirst("en-IN")).toBe(false);
    expect(localeUsesMonthFirst("en-GB")).toBe(false);
  });
});

describe("drafts from a sheet", () => {
  const matrix: unknown[][] = [
    ["Topic", "Date", "Content type", "Platform", "Time", "Description"],
    ["World AIDS Day", "01/12/2026", "Carousel", "instagram, linkedin", "10:00 AM", "Caption"],
    ["", "", "", "", "", ""],
    ["Christmas", "25/12/2026", "Reel", "ig", "09:00", ""],
  ];
  const mapping = autoMapColumns(matrix[0] as string[]);

  it("skips blank rows and normalises values", () => {
    const drafts = draftsFromMatrix(matrix, mapping, { monthFirst: false });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      name: "World AIDS Day",
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      time: "10:00",
      content_type: "Carousel",
      platforms: ["instagram", "linkedin"],
      short_description: "Caption",
      category: "Other",
    });
    expect(drafts[1]?.start_date).toBe("2026-12-25");
  });

  it("marks duplicates against the calendar and within the sheet", () => {
    const existing = existingKeySet([{ start_date: "2026-12-01", name: "World AIDS Day" }]);
    const checks = validateDrafts(draftsFromMatrix(matrix, mapping, { monthFirst: false }), existing);
    expect(checks[0]?.duplicate).toBe(true);
    expect(checks[0]?.canInclude).toBe(false);
    expect(checks[0]?.problems.some((p) => p.message.includes("Already in this calendar"))).toBe(true);
    expect(checks[1]?.canInclude).toBe(true);

    const twice = draftsFromMatrix(
      [
        ["Topic", "Date"],
        ["Same topic", "2027-01-01"],
        ["Same topic", "2027-01-01"],
      ],
      ["name", "start_date"],
    );
    const sameSheet = validateDrafts(twice, new Set());
    expect(sameSheet[0]?.canInclude).toBe(true);
    expect(sameSheet[1]?.duplicate).toBe(true);
    expect(sameSheet[1]?.problems.some((p) => p.message.includes("Duplicate row"))).toBe(true);
  });

  it("requires a topic and a valid date", () => {
    const draft = draftsFromMatrix(
      [
        ["Topic", "Date"],
        ["", "not a date"],
      ],
      ["name", "start_date"],
    )[0];
    const check = validateDrafts(draft ? [draft] : [], new Set())[0];
    expect(check?.canInclude).toBe(false);
    expect(check?.problems.map((p) => p.message)).toContain("Topic is required");
    expect(check?.problems.map((p) => p.message)).toContain("Pick a valid date (YYYY-MM-DD)");
  });

  it("warns about unrecognised platforms and bad source links", () => {
    const draft = draftsFromMatrix(
      [
        ["Topic", "Date", "Platform", "Source"],
        ["Event", "2027-01-01", "instgram", "http://example.com"],
      ],
      ["name", "start_date", "platforms", "source_url"],
    )[0];
    const check = validateDrafts(draft ? [draft] : [], new Set())[0];
    expect(check?.canInclude).toBe(true);
    const messages = check?.problems.map((p) => p.message).join(" | ");
    expect(messages).toContain("Check platform spelling: instgram");
    expect(messages).toContain("Source link ignored");
  });
});

describe("event input", () => {
  it("maps an edited draft to the calendar event fields", () => {
    const draft = draftsFromMatrix(
      [
        ["Topic", "Date", "End date", "Content type", "Platform", "Time", "Hashtags", "Source"],
        ["World AIDS Day", "2026-12-01", "2026-12-02", "Carousel", "instagram, linkedin", "10:00", "#Health", "https://www.who.int"],
      ],
      ["name", "start_date", "end_date", "content_type", "platforms", "time", "hashtags", "source_url"],
    )[0];
    expect(draft).toBeDefined();
    if (!draft) return;
    const input = toEventInput(draft, "IN");
    expect(input).toMatchObject({
      name: "World AIDS Day",
      start_date: "2026-12-01",
      end_date: "2026-12-02",
      content_format: "Carousel",
      time_override: "10:00",
      platforms: ["instagram", "linkedin"],
      hashtags: ["#Health"],
      event_kind: "custom",
      verification_status: "source_provided",
      scope: "IN",
    });
  });

  it("treats text cells as trimmed text", () => {
    expect(cellToText("  hello  ")).toBe("hello");
    expect(cellToText(42)).toBe("42");
    expect(cellToText(null)).toBe("");
  });
});
