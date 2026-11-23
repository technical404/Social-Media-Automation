import { describe, expect, it } from "vitest";
import { groupPostsByTopic } from "@/lib/post-groups";
import type { PostRow } from "@/lib/repo";

const row = (id: string, topic: string, scheduled_at: string | null): PostRow => ({
  id,
  body: id,
  platform: "instagram",
  status: "draft",
  scheduled_at,
  fail_reason: null,
  campaign_id: null,
  client_id: "c1",
  topic,
  pillar: "",
  content_format: "",
  hashtags: "[]",
});

describe("groupPostsByTopic", () => {
  it("groups by topic and sorts each group by scheduled time", () => {
    const groups = groupPostsByTopic([
      row("b", "Hydration", "2027-02-10T10:00"),
      row("a", "Hydration", "2027-02-01T10:00"),
      row("c", "Lab tests", "2027-02-05T10:00"),
    ]);
    expect(groups.map((g) => g.topic)).toEqual(["Hydration", "Lab tests"]);
    expect(groups[0]?.rows.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("falls back to a General posts group", () => {
    expect(groupPostsByTopic([row("a", "  ", "2027-02-01T10:00")])[0]?.topic).toBe("General posts");
  });

  it("orders groups by their earliest post", () => {
    const groups = groupPostsByTopic([
      row("late", "Later", "2027-03-01T10:00"),
      row("early", "Earlier", "2027-01-01T10:00"),
    ]);
    expect(groups.map((g) => g.topic)).toEqual(["Earlier", "Later"]);
  });
});
