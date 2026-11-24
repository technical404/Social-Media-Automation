import { describe, expect, it } from "vitest";
import { PLATFORM_CONTENT_TYPES, contentTypesForPlatforms, platformSummary } from "@/lib/platforms";
import { CONTENT_TYPES } from "@/lib/planner";

describe("platform content types", () => {
  it("limits Instagram to Instagram formats", () => {
    const types = contentTypesForPlatforms(["instagram"]);
    expect(types).toContain("Reel");
    expect(types).toContain("Story");
    expect(types).not.toContain("Post");
    expect(types.every((type) => PLATFORM_CONTENT_TYPES["instagram"]!.includes(type))).toBe(true);
  });

  it("combines the formats of every selected platform", () => {
    const types = contentTypesForPlatforms(["instagram", "linkedin"]);
    expect(types).toContain("Reel");
    expect(types).toContain("Post");
  });

  it("falls back to every format when no platform is selected", () => {
    expect(contentTypesForPlatforms([])).toEqual([...CONTENT_TYPES]);
  });

  it("summarises Facebook plus Instagram as Meta", () => {
    expect(platformSummary(["facebook", "instagram"])).toBe("Meta");
    expect(platformSummary(["instagram"])).toBe("Instagram");
    expect(platformSummary(["facebook", "linkedin"])).toBe("Facebook, LinkedIn");
  });
});
