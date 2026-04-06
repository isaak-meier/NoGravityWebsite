/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { attachKnobContinuous, attachKnobDiscrete, attachKnobDiscrete3 } from "./gui-knob.js";

function makeFolder() {
  const el = document.createElement("div");
  el.className = "lil-children";
  return { $children: el };
}

describe("gui-knob", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts continuous knob into folder.$children", () => {
    const folder = makeFolder();
    const o = { v: 0.5 };
    attachKnobContinuous(folder, {
      label: "Test",
      object: o,
      key: "v",
      min: 0,
      max: 1,
      step: 0.01,
    });
    expect(folder.$children.querySelector(".gui-knob-dial")).toBeTruthy();
    expect(o.v).toBe(0.5);
  });

  it("mounts discrete knob into folder", () => {
    const folder = makeFolder();
    const o = { mode: 1 };
    attachKnobDiscrete3(folder, {
      label: "Pat",
      object: o,
      key: "mode",
      labels: ["A", "B", "C"],
    });
    expect(folder.$children.querySelector(".gui-knob-dial--three")).toBeTruthy();
    expect(o.mode).toBe(1);
  });

  it("supports four-stop discrete knob", () => {
    const folder = makeFolder();
    const o = { mode: 3 };
    attachKnobDiscrete(folder, {
      label: "Pat",
      object: o,
      key: "mode",
      labels: ["A", "B", "C", "D"],
    });
    expect(folder.$children.querySelector(".gui-knob-dial")).toBeTruthy();
    expect(o.mode).toBe(3);
  });

  it("falls back to .lil-children query when $children missing", () => {
    const root = document.createElement("div");
    const inner = document.createElement("div");
    inner.className = "lil-children";
    root.appendChild(inner);
    const folder = { domElement: root };
    const o = { v: 0.2 };
    attachKnobContinuous(folder, {
      label: "T",
      object: o,
      key: "v",
      min: 0,
      max: 1,
    });
    expect(inner.querySelector(".gui-knob-dial")).toBeTruthy();
  });
});
