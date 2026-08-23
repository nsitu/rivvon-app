import { describe, expect, it } from "vitest";
import {
  getSeamlessLoopDurationForMotionRate,
  normalizeMotionLoopDurationMultiplier,
} from "./seamlessLoop.js";

describe("motion loop rates", () => {
  it.each([1, 2, 3, 4, 0.5, 1 / 3, 0.25])(
    "accepts supported duration multiplier %s",
    (value) => {
      expect(normalizeMotionLoopDurationMultiplier(value)).toBe(value);
    },
  );

  it("falls back to one material loop for unsupported rates", () => {
    expect(normalizeMotionLoopDurationMultiplier(0.4)).toBe(1);
  });

  it("scales motion duration without changing material loop duration", () => {
    const tileManager = {
      getSeamlessLoopDuration: () => 12,
    };

    expect(getSeamlessLoopDurationForMotionRate(tileManager, 0.5, false)).toBe(6);
    expect(getSeamlessLoopDurationForMotionRate(tileManager, 1 / 3, false)).toBe(4);
    expect(getSeamlessLoopDurationForMotionRate(tileManager, 3, false)).toBe(36);
  });
});
