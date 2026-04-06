import { valueToKnobAngle } from "./continuous-knob-math.js";
import { wireContinuousKnobCanvas } from "./continuous-knob-wire.js";

const LOGICAL_SIZE = 46;

function setupHiDpiCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = LOGICAL_SIZE * dpr;
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${LOGICAL_SIZE}px`;
  canvas.style.height = `${LOGICAL_SIZE}px`;
  return dpr;
}

function drawFace(ctx, r, dpr) {
  const cx = r;
  const cy = r;
  const g = ctx.createRadialGradient(cx, cy * 0.42, r * 0.05, cx, cy, r * 1.05);
  g.addColorStop(0, "#4a5c72");
  g.addColorStop(0.42, "#1a222e");
  g.addColorStop(1, "#0c1018");
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = "rgba(34, 211, 238, 0.45)";
  ctx.lineWidth = 1 * dpr;
  ctx.shadowColor = "rgba(34, 211, 238, 0.12)";
  ctx.shadowBlur = 6 * dpr;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(cx, cy, r - 4 * dpr, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.9)";
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();

  const inner = ctx.createRadialGradient(cx * 0.92, cy * 0.78, 0, cx, cy, r * 0.85);
  inner.addColorStop(0, "rgba(56, 189, 248, 0.08)");
  inner.addColorStop(0.55, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.strokeStyle = "rgba(34, 211, 238, 0.18)";
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();
}

function drawPointer(ctx, r, dpr, angle) {
  const cx = r;
  const cy = r;
  const len = r * 0.46;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, "rgba(34, 211, 238, 0.15)");
  grad.addColorStop(0.72, "rgba(103, 232, 249, 0.85)");
  grad.addColorStop(1, "#ecfeff");
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3.5 * dpr;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(34, 211, 238, 0.95)";
  ctx.shadowBlur = 8 * dpr;
  ctx.stroke();
  ctx.restore();
}

function paint(canvas, min, max, value) {
  const dpr = setupHiDpiCanvas(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const r = (canvas.width / 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawFace(ctx, r, dpr);
  const angle = valueToKnobAngle(value, min, max);
  drawPointer(ctx, r, dpr, angle);
}

/**
 * Canvas-rendered cockpit knob (same interaction model as DOM .gui-knob-dial).
 * @param {HTMLElement} widget
 * @param {HTMLElement} readout
 * @param {object} opts
 */
export function mountScreenCanvasKnob(widget, readout, opts) {
  const { object, key, min, max, step, format } = opts;
  const canvas = document.createElement("canvas");
  canvas.className = "screen-cockpit-knob";
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-valuemin", String(min));
  canvas.setAttribute("aria-valuemax", String(max));
  canvas.setAttribute("tabindex", "0");

  function redraw(v) {
    paint(canvas, min, max, v);
  }

  widget.appendChild(canvas);
  widget.appendChild(readout);

  window.addEventListener("resize", () => redraw(object[key]));

  return wireContinuousKnobCanvas(canvas, readout, opts, redraw);
}
