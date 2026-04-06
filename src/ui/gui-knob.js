/**
 * Rotary dials for lil-gui: drag to turn (continuous or discrete stops).
 * Appends rows to `folder.$children` with matching `.lil-controller` layout.
 */

import { AN_MIN, AN_MAX } from "./continuous-knob-math.js";
import { wireContinuousKnob } from "./continuous-knob-wire.js";

/** @param {{ $children?: HTMLElement, domElement?: HTMLElement }} folder */
function getFolderChildrenEl(folder) {
  if (folder?.$children) return folder.$children;
  return folder?.domElement?.querySelector?.(".lil-children") ?? null;
}

/**
 * @param {{ $children: HTMLElement }} folder lil-gui folder or root
 * @param {object} opts
 * @param {string} opts.label
 * @param {object} opts.object
 * @param {string} opts.key
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} [opts.step]
 * @param {(v: number) => string} [opts.format]
 * @param {() => void} [opts.onChange]
 */
export function attachKnobContinuous(folder, opts) {
  const {
    label, object, key, min, max, step = 0.01, format = v => v.toFixed(2),
    onChange,
  } = opts;
  const { row, widget } = createLilRow(label);

  const dial = document.createElement("div");
  dial.className = "gui-knob-dial";
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-valuemin", String(min));
  dial.setAttribute("aria-valuemax", String(max));
  dial.setAttribute("tabindex", "0");

  const pointer = document.createElement("div");
  pointer.className = "gui-knob-pointer";

  const readout = document.createElement("div");
  readout.className = "gui-knob-readout";

  dial.appendChild(pointer);
  widget.appendChild(dial);
  widget.appendChild(readout);

  const { sync } = wireContinuousKnob(dial, pointer, readout, {
    object, key, min, max, step, format, onChange,
  });

  const parent = getFolderChildrenEl(folder);
  if (parent?.appendChild) parent.appendChild(row);

  return { sync, domElement: row };
}

/**
 * Fixed stops (e.g. pattern mode). Drag rotates through stops via angle delta.
 * @param {{ $children: HTMLElement }} folder
 * @param {object} opts
 * @param {string[]} opts.labels — one stop per index (length ≥ 1)
 */
export function attachKnobDiscrete(folder, opts) {
  const { label, object, key, labels, onChange } = opts;
  const maxIdx = labels.length - 1;
  if (maxIdx < 0) throw new Error("attachKnobDiscrete: labels must be non-empty");

  const { row, widget } = createLilRow(label);

  const dial = document.createElement("div");
  dial.className = "gui-knob-dial gui-knob-dial--three";
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-valuemin", "0");
  dial.setAttribute("aria-valuemax", String(maxIdx));
  dial.setAttribute("tabindex", "0");

  const pointer = document.createElement("div");
  pointer.className = "gui-knob-pointer";

  const readout = document.createElement("div");
  readout.className = "gui-knob-readout";

  dial.appendChild(pointer);
  widget.appendChild(dial);
  widget.appendChild(readout);

  const angles = labels.map((_, i) =>
    (maxIdx === 0 ? AN_MIN : AN_MIN + (i / maxIdx) * (AN_MAX - AN_MIN)),
  );

  function idxToAngle(i) {
    return angles[Math.min(maxIdx, Math.max(0, i))];
  }

  function syncFromObject() {
    const i = Math.min(maxIdx, Math.max(0, object[key] | 0));
    object[key] = i;
    readout.textContent = labels[i] ?? String(i);
    pointer.style.transform = `rotate(${idxToAngle(i) * (180 / Math.PI)}deg)`;
    dial.setAttribute("aria-valuenow", String(i));
  }

  syncFromObject();

  function applyIdx(i) {
    object[key] = i;
    syncFromObject();
    onChange?.();
  }

  let dragging = false;
  let lastY = 0;
  /** Pixels of vertical travel per detent (drag up = toward higher index). */
  const STEP_PX = 28;
  let accum = 0;

  function onMove(clientY) {
    if (!dragging) return;
    const dy = clientY - lastY;
    lastY = clientY;
    accum += -dy;
    let cur = Math.min(maxIdx, Math.max(0, object[key] | 0));
    while (accum >= STEP_PX && cur < maxIdx) {
      accum -= STEP_PX;
      cur++;
      applyIdx(cur);
    }
    while (accum <= -STEP_PX && cur > 0) {
      accum += STEP_PX;
      cur--;
      applyIdx(cur);
    }
  }

  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    lastY = e.clientY;
    accum = 0;
    dial.setPointerCapture(e.pointerId);
  });

  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    onMove(e.clientY);
  });

  dial.addEventListener("pointerup", (e) => {
    dragging = false;
    accum = 0;
    try {
      dial.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  });

  dial.addEventListener("pointercancel", () => {
    dragging = false;
    accum = 0;
  });

  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = Math.min(maxIdx, Math.max(0, object[key] | 0));
    const next = e.deltaY > 0 ? cur - 1 : cur + 1;
    applyIdx(Math.min(maxIdx, Math.max(0, next)));
  }, { passive: false });

  dial.addEventListener("keydown", (e) => {
    const cur = Math.min(maxIdx, Math.max(0, object[key] | 0));
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      applyIdx(Math.max(0, cur - 1));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      applyIdx(Math.min(maxIdx, cur + 1));
    }
  });

  const parent = getFolderChildrenEl(folder);
  if (parent?.appendChild) parent.appendChild(row);

  return { sync: syncFromObject, domElement: row };
}

/**
 * @deprecated Prefer {@link attachKnobDiscrete} with any number of labels.
 * Three fixed stops (e.g. pattern mode 0,1,2). Drag rotates through stops via angle delta.
 */
export function attachKnobDiscrete3(folder, opts) {
  return attachKnobDiscrete(folder, opts);
}

function createLilRow(labelText) {
  const row = document.createElement("div");
  row.classList.add("lil-controller", "gui-knob-row");
  const name = document.createElement("div");
  name.classList.add("lil-name");
  name.textContent = labelText;
  const widget = document.createElement("div");
  widget.classList.add("lil-widget");
  row.appendChild(name);
  row.appendChild(widget);
  return { row, widget };
}
