import * as THREE from "three";

/**
 * Planet Growth palette — five named colors. Driven hex values are 0xRRGGBB so they pass
 * straight to {@link THREE.Color} and to inline CSS via `hex.toString(16)`.
 */
export const PLANET_GROWTH_PALETTE = [
  { name: "Vintage Lavender", hex: 0x8d6a9f },
  { name: "Sky Reflection", hex: 0x86bbd8 },
  { name: "Petal Frost", hex: 0xefcfe3 },
  { name: "Ink Black", hex: 0x011627 },
  { name: "Dark Teal", hex: 0x19535f },
];
export const PLANET_GROWTH_PALETTE_SIZE = PLANET_GROWTH_PALETTE.length;

/** Quick-start, slow-stop motion: each beat injects this much angular velocity (rad/s) per unit intensity. */
const BEAT_IMPULSE_RAD_PER_SEC = 5.5;
/** Per-frame audio energy: each unit of frame-to-frame rise in bass adds this much angular velocity. */
const AUDIO_RISE_IMPULSE_RAD_PER_SEC = 9.0;
/** Slow stop: exponential decay timescale for angular velocity. Larger = longer coast. */
const ROTATION_DECAY_TAU_SEC = 1.8;
/** Orbit radius as a fraction of min(container width, height). */
const ORBIT_RADIUS_FRACTION = 0.28;

const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _axis = new THREE.Vector3();

function hexToCssColor(hex) {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function pickContrastInk(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.55 ? "rgba(15, 23, 36, 0.95)" : "rgba(248, 250, 252, 0.95)";
}

function createHandleDom(entry, paletteIndex) {
  const el = document.createElement("div");
  el.className = "green-fade-handle green-fade-handle--hidden";
  el.dataset.paletteIndex = String(paletteIndex);
  el.title = entry.name;
  el.setAttribute("aria-label", `Planet Growth ${entry.name} handle`);
  el.style.background = hexToCssColor(entry.hex);
  el.style.borderColor = pickContrastInk(entry.hex);
  return el;
}

function placeHandle(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function layoutOrbit({ handles, baseAngles, rotation, rect, camera, axesUniform }) {
  const cx = rect.width * 0.5;
  const cy = rect.height * 0.5;
  const radius = Math.min(rect.width, rect.height) * ORBIT_RADIUS_FRACTION;
  _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  for (let i = 0; i < handles.length; i++) {
    const a = baseAngles[i] + rotation;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    placeHandle(handles[i], cx + dx * radius, cy + dy * radius);
    // World-space axis lives in the camera image plane. Flip Y so screen-down maps to camera-down.
    _axis.copy(_camRight).multiplyScalar(dx).addScaledVector(_camUp, -dy);
    _axis.normalize();
    axesUniform.value[i].copy(_axis);
  }
}

/**
 * On-screen handles for the Planet Growth feature. One handle per palette color sits on a ring
 * around the screen center; the ring rotates in response to music beats via {@link pulse}.
 * Each handle's screen position is projected into a world-space axis in the camera image plane
 * and written into the shader's `uAxes[i]` uniform every frame.
 *
 * @param {HTMLElement} container — three-container; elements are positioned relative to it
 * @param {object} opts
 * @param {import("three").Camera} opts.camera
 * @param {{ fade: { uniforms: { uAxes: { value: import("three").Vector3[] } } } }} opts.planet
 */
export function createGreenPlanetFadeHandles(container, { camera, planet }) {
  const title = document.createElement("div");
  title.className = "planet-growth-title planet-growth-title--hidden";
  title.textContent = "Planet Growth";
  container.appendChild(title);

  const handles = [];
  const baseAngles = [];
  for (let i = 0; i < PLANET_GROWTH_PALETTE_SIZE; i++) {
    const el = createHandleDom(PLANET_GROWTH_PALETTE[i], i);
    container.appendChild(el);
    handles.push(el);
    baseAngles.push((i / PLANET_GROWTH_PALETTE_SIZE) * Math.PI * 2 - Math.PI / 2);
  }

  const motion = { rotation: 0, angularVelocity: 0, lastAudioLevel: 0 };
  const layoutNow = () => layoutOrbit({
    handles, baseAngles,
    rotation: motion.rotation,
    rect: container.getBoundingClientRect(),
    camera,
    axesUniform: planet.fade.uniforms.uAxes,
  });
  layoutNow();

  return {
    update(dt) {
      const step = Math.max(0, Math.min(0.1, dt || 0));
      motion.rotation += motion.angularVelocity * step;
      motion.angularVelocity *= Math.exp(-step / ROTATION_DECAY_TAU_SEC);
      layoutNow();
    },
    pulse(intensity) {
      const strength = Math.max(0, Math.min(1, intensity));
      if (strength <= 0) return;
      motion.angularVelocity += BEAT_IMPULSE_RAD_PER_SEC * strength;
    },
    /**
     * Feed the latest bass / low-band audio level (0..1). Frame-to-frame rises inject angular
     * impulse so the orbit keeps pulsing for the whole song instead of relying on the binary
     * beat detector, whose EMA threshold saturates after the first few seconds of audio.
     */
    setAudioLevel(level) {
      const clamped = Math.max(0, Math.min(1, level || 0));
      const rise = Math.max(0, clamped - motion.lastAudioLevel);
      motion.lastAudioLevel = clamped;
      if (rise <= 0) return;
      motion.angularVelocity += rise * AUDIO_RISE_IMPULSE_RAD_PER_SEC;
    },
    setVisible(visible) {
      title.classList.toggle("planet-growth-title--hidden", !visible);
      for (const el of handles) el.classList.toggle("green-fade-handle--hidden", !visible);
    },
    dispose() {
      title.remove();
      for (const el of handles) el.remove();
    },
  };
}
