import { describe, expect, it } from "vitest";
import { auditLayout, overflowAxis, rectsOverlap } from "@/lib/layout-audit";

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("rectsOverlap", () => {
  it("finds boxes that share pixels", () => {
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(90, 10, 200, 30))).toBe(true);
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(50, 5, 150, 15))).toBe(true);
  });

  it("ignores boxes that are merely adjacent", () => {
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(100, 0, 200, 20))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(0, 20, 100, 40))).toBe(false);
  });

  it("honours the tolerance so a rounded pixel cannot raise a false alarm", () => {
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(99.5, 0, 200, 20))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 100, 20), rect(99.5, 0, 200, 20), 0)).toBe(true);
  });
});

describe("overflowAxis", () => {
  it("reports the axis whose content exceeds its box", () => {
    expect(overflowAxis(160, 100, 20, 20)).toBe("horizontal");
    expect(overflowAxis(100, 100, 60, 20)).toBe("vertical");
    expect(overflowAxis(100, 100, 20, 20)).toBeNull();
  });

  it("tolerates sub-pixel rounding", () => {
    expect(overflowAxis(101, 100, 20, 20)).toBeNull();
    expect(overflowAxis(103, 100, 20, 20)).toBe("horizontal");
  });
});

describe("auditLayout", () => {
  it("is a no-op without a document (SSR safe)", () => {
    expect(auditLayout(null)).toEqual([]);
  });
});