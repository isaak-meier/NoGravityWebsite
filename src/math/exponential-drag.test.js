import { describe, it, expect } from "vitest";
import {
  exponentialDragBlend,
  DEFAULT_EXPONENTIAL_DRAG_TAU,
} from "./exponential-drag.js";

describe("exponentialDragBlend", () => {
  /**
   * Sample pairs (deltaTime, tau) → expected blend α = 1 − exp(−dt/τ).
   * Used as documentation and regression anchors for typical game/60fps steps.
   */
  const samples = [
    {
      name: "~60fps frame with default shatter τ",
      deltaTime: 1 / 60,
      tau: DEFAULT_EXPONENTIAL_DRAG_TAU,
      alpha: 1 - Math.exp(-(1 / 60) / DEFAULT_EXPONENTIAL_DRAG_TAU),
    },
    {
      name: "one τ worth of elapsed time",
      deltaTime: 0.12,
      tau: 0.12,
      alpha: 1 - Math.exp(-1),
    },
    {
      name: "slow follow (large τ)",
      deltaTime: 0.016,
      tau: 0.5,
      alpha: 1 - Math.exp(-0.016 / 0.5),
    },
    {
      name: "snappy follow (small τ)",
      deltaTime: 0.016,
      tau: 0.04,
      alpha: 1 - Math.exp(-0.016 / 0.04),
    },
  ];

  it.each(samples)(
    "matches closed form for $name",
    ({ deltaTime, tau, alpha }) => {
      expect(exponentialDragBlend(deltaTime, tau)).toBeCloseTo(alpha, 10);
    },
  );

  it("returns 0 when deltaTime is 0 (no step, no motion)", () => {
    expect(exponentialDragBlend(0, 0.12)).toBe(0);
  });

  it("returns 0 when deltaTime is negative", () => {
    expect(exponentialDragBlend(-0.01, 0.12)).toBe(0);
  });

  it("returns 1 when tau is 0 (instant snap)", () => {
    expect(exponentialDragBlend(0.016, 0)).toBe(1);
  });

  it("returns 1 when tau is negative (treat as instant)", () => {
    expect(exponentialDragBlend(0.016, -1)).toBe(1);
  });

  it("returns 0 for non-finite deltaTime", () => {
    expect(exponentialDragBlend(Number.NaN, 0.12)).toBe(0);
    expect(exponentialDragBlend(Number.POSITIVE_INFINITY, 0.12)).toBe(0);
  });

  it("returns 0 for non-finite tau (unless handled as instant)", () => {
    expect(exponentialDragBlend(0.016, Number.NaN)).toBe(0);
  });
});
