import * as THREE from "three";

/**
 * Vertical throttle lever pinned to the right edge of the viewport. Pointer-drag
 * along the track sets the throttle 0..1; the value is reported via `onChange`
 * so the game can wire it straight into its rocket integrator.
 * @param {(value: number) => void} onChange
 */
function createThrottleControl(onChange) {
  const root = document.createElement("div");
  root.className = "shard-flight-throttle";
  root.setAttribute("aria-label", "Shard flight throttle");

  const label = document.createElement("div");
  label.className = "shard-flight-throttle__label";
  label.textContent = "Throttle";

  const track = document.createElement("div");
  track.className = "shard-flight-throttle__track";
  track.setAttribute("role", "slider");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.tabIndex = 0;

  const fill = document.createElement("div");
  fill.className = "shard-flight-throttle__fill";
  const thumb = document.createElement("div");
  thumb.className = "shard-flight-throttle__thumb";
  track.appendChild(fill);
  track.appendChild(thumb);

  const readout = document.createElement("div");
  readout.className = "shard-flight-throttle__value";
  readout.textContent = "0%";

  root.appendChild(label);
  root.appendChild(track);
  root.appendChild(readout);

  let value = 0;
  let dragging = false;
  let activePointer = -1;

  const setValue = (v) => {
    value = Math.max(0, Math.min(1, v));
    const pct = Math.round(value * 100);
    fill.style.height = `${(value * 100).toFixed(1)}%`;
    thumb.style.bottom = `${(value * 100).toFixed(1)}%`;
    readout.textContent = `${pct}%`;
    track.setAttribute("aria-valuenow", String(pct));
    onChange(value);
  };

  const updateFromClientY = (clientY) => {
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return;
    setValue(1 - (clientY - rect.top) / rect.height);
  };

  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    activePointer = e.pointerId;
    try { track.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    updateFromClientY(e.clientY);
    e.preventDefault();
    e.stopPropagation();
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== activePointer) return;
    updateFromClientY(e.clientY);
    e.stopPropagation();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    if (e.pointerId === activePointer) {
      dragging = false;
      activePointer = -1;
      try { track.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("pointerleave", (e) => {
    if (dragging && e.pointerId === activePointer) {
      // Keep the drag alive via pointer capture even if we leave the track box.
    }
  });
  // Prevent the camera click-pick from picking up these as canvas clicks.
  track.addEventListener("click", (e) => e.stopPropagation());

  track.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      setValue(value + step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      setValue(value - step);
      e.preventDefault();
    } else if (e.key === "Home") {
      setValue(0);
      e.preventDefault();
    } else if (e.key === "End") {
      setValue(1);
      e.preventDefault();
    }
  });

  setValue(0);

  return {
    root,
    setValue,
    getValue: () => value,
    /** True if the user's pointer is currently dragging the track (so click-to-boost ignores it). */
    isDragging: () => dragging,
    /** Forwarded by the parent so click-to-boost knows to skip events on the throttle UI. */
    contains: (el) => root.contains(el),
  };
}

/**
 * Slim fuel/boost readout that shows under the throttle. Read by the game each frame.
 */
function createFuelGauge() {
  const root = document.createElement("div");
  root.className = "shard-flight-fuel";
  root.setAttribute("aria-hidden", "true");
  const label = document.createElement("div");
  label.className = "shard-flight-fuel__label";
  label.textContent = "Fuel";
  const bar = document.createElement("div");
  bar.className = "shard-flight-fuel__bar";
  const fill = document.createElement("div");
  fill.className = "shard-flight-fuel__fill";
  bar.appendChild(fill);
  root.appendChild(label);
  root.appendChild(bar);
  return {
    root,
    setFraction(f) {
      const pct = Math.max(0, Math.min(1, f)) * 100;
      fill.style.width = `${pct.toFixed(1)}%`;
      fill.classList.toggle("shard-flight-fuel__fill--low", f < 0.18);
    },
  };
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {boolean} opts.isMobile
 * @param {() => void} opts.onStartFlight
 * @param {() => void} opts.onRestart
 * @param {() => void} opts.onExitFlight
 * @param {(throttle: number) => void} opts.onThrottleChange
 * @param {() => void} opts.onBoost
 */
export function createShardFlightHud(container, {
  isMobile,
  onStartFlight,
  onRestart,
  onExitFlight,
  onThrottleChange,
  onBoost,
}) {
  const root = document.createElement("div");
  root.className = "shard-flight-hud";

  const startLabel = "Shard flight";
  const exitLabel = "Exit shard flight";
  const startAria = "Start shard flight mini-game: third-person ship around the shard field";
  const exitAria = "Exit shard flight mini-game";

  let active = false;

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "shard-flight-btn";
  startBtn.textContent = startLabel;
  startBtn.setAttribute("aria-label", startAria);
  if (isMobile) {
    startBtn.disabled = true;
    startBtn.title = "Shard flight is desktop only for now";
    startBtn.setAttribute("aria-disabled", "true");
  }
  startBtn.addEventListener("click", () => {
    if (startBtn.disabled) return;
    if (active) onExitFlight();
    else onStartFlight();
  });

  const hint = document.createElement("div");
  hint.className = "shard-flight-hud__hint";
  hint.textContent =
    "W A S D aims · click anywhere to fire boosters · drag the throttle to set thrust · shards = game over";
  hint.setAttribute("aria-hidden", "true");
  root.appendChild(hint);

  const aimDot = document.createElement("div");
  aimDot.className = "shard-flight-hud__aim-dot";
  aimDot.setAttribute("aria-hidden", "true");
  container.appendChild(aimDot);

  const throttle = createThrottleControl((v) => onThrottleChange?.(v));
  container.appendChild(throttle.root);

  const fuelGauge = createFuelGauge();
  throttle.root.appendChild(fuelGauge.root);

  const gameOver = document.createElement("div");
  gameOver.className = "shard-flight-game-over";
  gameOver.setAttribute("role", "dialog");
  gameOver.setAttribute("aria-modal", "true");
  gameOver.setAttribute("aria-label", "Shard flight game over");

  const goTitle = document.createElement("div");
  goTitle.className = "shard-flight-game-over__title";
  goTitle.textContent = "Ship destroyed";
  gameOver.appendChild(goTitle);

  const btnRow = document.createElement("div");
  btnRow.className = "shard-flight-game-over__row";

  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "shard-flight-btn";
  restartBtn.textContent = "Restart";
  restartBtn.addEventListener("click", () => onRestart());
  btnRow.appendChild(restartBtn);

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "shard-flight-btn shard-flight-btn--secondary";
  exitBtn.textContent = "Exit flight";
  exitBtn.addEventListener("click", () => onExitFlight());
  btnRow.appendChild(exitBtn);

  gameOver.appendChild(btnRow);
  container.appendChild(gameOver);

  const _ndc = new THREE.Vector3();

  // Click-to-boost: any pointerdown on the canvas/container that isn't on an interactive
  // HUD element triggers the boosters. We attach to `container` rather than the canvas
  // directly so the existing camera-controller click handler (which is also on the
  // container but already short-circuits while shardFlightMode is on) doesn't fight us.
  const isInteractiveTarget = (target) => {
    if (!(target instanceof Element)) return false;
    if (throttle.contains(target)) return true;
    if (gameOver.contains(target)) return true;
    if (target.closest("button, input, select, textarea, [data-shard-flight-ignore-boost]")) {
      return true;
    }
    if (target.closest(".shard-flight-hud, .planet-switcher-hud, .enter-planet-hud, .camera-distance-hud, .bottom-left-hud, .auth-ui, .planet-interior-hud, .planet-mailing-panel")) {
      return true;
    }
    return false;
  };

  const handleBoostPointer = (e) => {
    if (!active) return;
    if (e.button !== undefined && e.button !== 0) return; // primary mouse only
    if (isInteractiveTarget(e.target)) return;
    if (throttle.isDragging()) return;
    onBoost?.();
  };
  container.addEventListener("pointerdown", handleBoostPointer);

  return {
    root,
    /** The caller is responsible for placing this in the DOM (e.g. alongside other corner controls). */
    flightButton: startBtn,
    setAimDotVisible(v) {
      aimDot.style.display = v ? "block" : "none";
      hint.style.display = v && !isMobile ? "block" : "none";
      active = v;
      startBtn.textContent = v ? exitLabel : startLabel;
      startBtn.setAttribute("aria-label", v ? exitAria : startAria);
    },
    setThrottleVisible(v) {
      throttle.root.classList.toggle("shard-flight-throttle--visible", !!v);
      if (!v) throttle.setValue(0);
    },
    setFuelFraction(f) {
      fuelGauge.setFraction(f);
    },
    /**
     * @param {import('three').Camera} camera
     * @param {import('three').Vector3} aimWorld
     * @param {HTMLElement} el
     */
    syncAimDot(camera, aimWorld, el) {
      if (aimDot.style.display === "none") return;
      _ndc.copy(aimWorld).project(camera);
      const rect = el.getBoundingClientRect();
      const x = ((_ndc.x + 1) / 2) * rect.width + rect.left;
      const y = ((-_ndc.y + 1) / 2) * rect.height + rect.top;
      aimDot.style.left = `${x}px`;
      aimDot.style.top = `${y}px`;
    },
    showGameOver() {
      gameOver.classList.add("shard-flight-game-over--visible");
    },
    hideGameOver() {
      gameOver.classList.remove("shard-flight-game-over--visible");
    },
  };
}
