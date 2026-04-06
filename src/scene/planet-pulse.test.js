import { describe, it, expect } from "vitest";
import {
  computeSmoothedPlanetScale,
  LOW_BAND_RADIUS_WEIGHT,
  PLANET_SCALE_SMOOTH_FACTOR,
} from "./planet-pulse.js";

describe("computeSmoothedPlanetScale", () => {
  it("lerps scale toward target from low-band average", () => {
    const baseRadius = 1;
    const lowAvg = 1;
    const { targetRadius, smoothedScale, displayRadius } = computeSmoothedPlanetScale(
      lowAvg,
      baseRadius,
      1,
    );
    expect(targetRadius).toBeCloseTo(baseRadius + lowAvg * LOW_BAND_RADIUS_WEIGHT);
    const targetScale = targetRadius / baseRadius;
    expect(smoothedScale).toBeCloseTo(
      1 + (targetScale - 1) * PLANET_SCALE_SMOOTH_FACTOR,
    );
    expect(displayRadius).toBeCloseTo(smoothedScale * baseRadius);
  });

  it("keeps displayRadius consistent with smoothed mesh scale", () => {
    const baseRadius = 0.9;
    const { smoothedScale, displayRadius } = computeSmoothedPlanetScale(1, baseRadius, 1);
    expect(displayRadius).toBeCloseTo(smoothedScale * baseRadius);
  });

  it("does not jump when lowAvg spikes: moves a fraction per frame", () => {
    const baseRadius = 1;
    const targetScale = (baseRadius + 1 * LOW_BAND_RADIUS_WEIGHT) / baseRadius;
    let scale = 1;
    for (let f = 0; f < 5; f++) {
      ({ smoothedScale: scale } = computeSmoothedPlanetScale(1, baseRadius, scale));
    }
    expect(scale).toBeLessThan(targetScale);
    expect(scale).toBeGreaterThan(1);
  });
});
