import { valueToKnobAngle, valueFromVerticalDragOffset } from "./continuous-knob-math.js";

/**
 * Pointer-drag + wheel + keyboard for a continuous value on `object[key]`.
 * Vertical drag: up increases (pointer moves clockwise), down decreases.
 */
export function wireContinuousKnob(dial, pointer, readout, opts) {
  const {
    object, key, min, max, step = 0.01, format = v => v.toFixed(2), onChange,
  } = opts;

  function setPointerRotation(angle) {
    pointer.style.transform = `rotate(${angle * (180 / Math.PI)}deg)`;
  }

  function syncFromObject() {
    const v = object[key];
    readout.textContent = format(v);
    setPointerRotation(valueToKnobAngle(v, min, max));
    dial.setAttribute("aria-valuenow", String(v));
  }

  function applyValue(v) {
    object[key] = v;
    syncFromObject();
    onChange?.();
  }

  const drag = createVerticalDragState(applyValue, { min, max, step, object, key });
  bindKnobEvents(dial, applyValue, drag, { min, max, step, object, key });

  syncFromObject();
  return { sync: syncFromObject };
}

export function createVerticalDragState(applyValue, { min, max, step, object, key }) {
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  function onMove(clientY) {
    if (!dragging) return;
    const dy = clientY - startY;
    const v = valueFromVerticalDragOffset(startVal, dy, min, max, step);
    applyValue(v);
  }

  return {
    start(_clientX, clientY) {
      dragging = true;
      startY = clientY;
      startVal = object[key];
    },
    move(clientY) {
      onMove(clientY);
    },
    end() {
      dragging = false;
    },
    isDragging() {
      return dragging;
    },
  };
}

export function bindKnobEvents(dial, applyValue, drag, { min, max, step, object, key }) {
  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag.start(e.clientX, e.clientY);
    dial.setPointerCapture(e.pointerId);
  });

  dial.addEventListener("pointermove", (e) => {
    if (!drag.isDragging()) return;
    e.preventDefault();
    drag.move(e.clientY);
  });

  dial.addEventListener("pointerup", (e) => {
    drag.end();
    try {
      dial.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  });

  dial.addEventListener("pointercancel", () => drag.end());

  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = object[key];
    const delta = e.deltaY > 0 ? -step : step;
    applyValue(Math.min(max, Math.max(min, cur + delta)));
  }, { passive: false });

  dial.addEventListener("keydown", (e) => {
    const cur = object[key];
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      applyValue(Math.max(min, cur - step));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      applyValue(Math.min(max, cur + step));
    }
  });
}

/**
 * Same behavior as wireContinuousKnob, but drives a redraw callback instead of a DOM pointer.
 * @param {(value: number) => void} redraw
 */
export function wireContinuousKnobCanvas(canvas, readout, opts, redraw) {
  const {
    object, key, min, max, step = 0.01, format = v => v.toFixed(2), onChange,
  } = opts;

  function syncFromObject() {
    const v = object[key];
    readout.textContent = format(v);
    canvas.setAttribute("aria-valuenow", String(v));
    redraw(v);
  }

  function applyValue(v) {
    object[key] = v;
    syncFromObject();
    onChange?.();
  }

  const drag = createVerticalDragState(applyValue, { min, max, step, object, key });
  bindKnobEvents(canvas, applyValue, drag, { min, max, step, object, key });

  syncFromObject();
  return { sync: syncFromObject };
}
