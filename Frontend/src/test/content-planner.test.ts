import { describe, expect, it } from "vitest";
import { buildTopicPrompt, mockTopicResponse, normalizePlatform, validateTopics, type ContentPlanRequest } from "@/lib/content-planner";
import { scopeWindow } from "@/lib/planner";

const req: ContentPlanRequest = {
  prompt: "Plan diabetes content",
  scope: { scope: "month", year: 2027, month: 2 },
  industry: "Hospital",
  region: "India",
  theme: "Diabetes care",
  maxTopics: 5,
  client_id: "c1",
  client_name: "Acme",
};

describe("topic-wise content planner", () => {
  it("puts the client, period and limit in the prompt", () => {
    const { system, user } = buildTopicPrompt(req);
    expect(system).toMatch(/topic-wise content calendar/i);
    expect(system).toMatch(/instagram/i);
    expect(user).toContain("Client: Acme");
    expect(user).toContain("At most 5 topics");
    expect(user).toContain("2027-02-01");
    expect(user).toContain("2027-02-28");
    expect(user).toContain("Diabetes care");
  });

  it("normalizes platform aliases", () => {
    expect(normalizePlatform("IG")).toBe("instagram");
    expect(normalizePlatform("twitter")).toBe("x");
    expect(normalizePlatform("LinkedIn")).toBe("linkedin");
  });

  it("accepts a valid topic plan and rejects bad dates, missing topics and duplicates", () => {
    const { accepted, rejected } = validateTopics(
      {
        topics: [
          { date: "2027-02-10", topic: "Diabetes education", pillar: "Education", platform: "IG", format: "Carousel", brief: "Practical tips", caption: "Small steps", hashtags: ["care"] },
          { date: "2027-03-01", topic: "Outside the month", platform: "instagram", format: "Post" },
          { date: "2027-02-11", topic: "", platform: "instagram", format: "Post" },
          { date: "2027-02-10", topic: "Diabetes education", platform: "instagram", format: "Post" },
        ],
      },
      { scope: req.scope, existing: [], maxTopics: 5 },
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ platform: "instagram", format: "Carousel", pillar: "Education", hashtags: ["#care"] });
    expect(rejected.map((r) => r.reason)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/outside the requested period/i),
        expect.stringMatching(/missing topic/i),
        expect.stringMatching(/duplicate/i),
      ]),
    );
  });

  it("rejects a topic already scheduled for the same client/date/platform", () => {
    const { accepted, rejected } = validateTopics(
      { topics: [{ date: "2027-02-10", topic: "Diabetes education", platform: "instagram", format: "Carousel" }] },
      { scope: req.scope, existing: [{ date: "2027-02-10", topic: "Diabetes education", platform: "instagram" }], maxTopics: 5 },
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/duplicate/i);
  });

  it("enforces the topic limit", () => {
    const topics = Array.from({ length: 3 }, (_, i) => ({ date: `2027-02-0${i + 1}`, topic: `Topic ${i}`, platform: "instagram", format: "Post" }));
    const { accepted, rejected } = validateTopics({ topics }, { scope: req.scope, existing: [], maxTopics: 2 });
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/over the limit/i);
  });

  it("only accepts selected dates when the scope is a date list", () => {
    const scope = { scope: "dates" as const, dates: ["2027-02-10", "2027-02-20"] };
    const { accepted, rejected } = validateTopics(
      {
        topics: [
          { date: "2027-02-10", topic: "Allowed", platform: "instagram" },
          { date: "2027-02-11", topic: "Not selected", platform: "instagram" },
        ],
      },
      { scope, existing: [], maxTopics: 5 },
    );
    expect(accepted.map((t) => t.topic)).toEqual(["Allowed"]);
    expect(rejected[0]?.reason).toMatch(/not one of the selected dates/i);
  });

  it("returns a deterministic test plan with recoverable bad items", () => {
    const { accepted, rejected } = validateTopics(JSON.parse(mockTopicResponse(req)), {
      scope: req.scope,
      existing: [],
      maxTopics: req.maxTopics,
    });
    const w = scopeWindow(req.scope);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((t) => t.date >= w.start && t.date <= w.end)).toBe(true);
    expect(rejected.some((r) => /outside the requested period/i.test(r.reason))).toBe(true);
    expect(rejected.some((r) => /missing topic/i.test(r.reason))).toBe(true);
  });
});
