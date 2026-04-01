import { describe, it, expect } from "vitest";
import {
  valueToKnobAngle,
  unwrapAngleDelta,
  valueFromVerticalDragOffset,
  VERTICAL_DRAG_PIXELS_PER_RANGE,
  AN_MIN,
  AN_MAX,
} from "./continuous-knob-math.js";

describe("continuous-knob-math", () => {
  it("maps min/max to 45° left / right of up (midpoint = straight up)", () => {
    expect(valueToKnobAngle(0, 0, 1)).toBeCloseTo(AN_MIN);
    expect(valueToKnobAngle(1, 0, 1)).toBeCloseTo(AN_MAX);
    expect(valueToKnobAngle(0.5, 0, 1)).toBeCloseTo(-Math.PI / 2);
  });

  it("unwrapAngleDelta returns smallest rotation", () => {
    expect(unwrapAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(unwrapAngleDelta(0, -Math.PI * 1.5))).toBeCloseTo(Math.PI / 2);
  });

  it("vertical drag: up (negative dy) increases value", () => {
    const px = VERTICAL_DRAG_PIXELS_PER_RANGE;
    expect(valueFromVerticalDragOffset(0.5, -px / 2, 0, 1, 0.01, px)).toBeCloseTo(1);
  });

  it("vertical drag: down (positive dy) decreases value", () => {
    const px = VERTICAL_DRAG_PIXELS_PER_RANGE;
    expect(valueFromVerticalDragOffset(0.5, px / 2, 0, 1, 0.01, px)).toBeCloseTo(0);
  });
});
