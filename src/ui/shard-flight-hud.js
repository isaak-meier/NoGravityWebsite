import {
  BATTLE_SHIP_HULL_SCALE_MIN,
  BATTLE_SHIP_HULL_SCALE_MAX,
  BATTLE_SHIP_HULL_SCALE_DEFAULT,
} from "../scene/shard-battle-helpers.js";

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

  const applyVisual = (v) => {
    value = Math.max(0, Math.min(1, v));
    const pct = Math.round(value * 100);
    fill.style.height = `${(value * 100).toFixed(1)}%`;
    thumb.style.bottom = `${(value * 100).toFixed(1)}%`;
    readout.textContent = `${pct}%`;
    track.setAttribute("aria-valuenow", String(pct));
  };
  /** User-initiated set — fires `onChange` so the game adopts the new value as a manual override. */
  const setValue = (v) => {
    applyVisual(v);
    onChange(value);
  };
  /** Game-initiated set — drives the slider visual to match the auto-ramped throttle without
   *  feeding back into the game. Skipped while the user is actively dragging so we don't fight
   *  their fingers. */
  const setVisualValue = (v) => {
    if (dragging) return;
    applyVisual(v);
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
    setVisualValue,
    getValue: () => value,
    /** True if the user's pointer is currently dragging the track (so the canvas press handler skips). */
    isDragging: () => dragging,
    /** Forwarded by the parent so the canvas press handler knows to skip events on the throttle UI. */
    contains: (el) => root.contains(el),
  };
}

/**
 * Battle-mode hull scale (left side, under Newton readout when flight is active).
 * @param {(hullScale: number) => void} onChange
 */
function createBattleShipSizeControl(onChange) {
  const root = document.createElement("div");
  root.className = "shard-flight-battle-size";
  root.setAttribute("aria-label", "Battle ship size");

  const label = document.createElement("div");
  label.className = "shard-flight-battle-size__label";
  label.textContent = "Ship size";

  const trackWrap = document.createElement("div");
  trackWrap.className = "shard-flight-battle-size__track-wrap";

  const input = document.createElement("input");
  input.type = "range";
  input.className = "shard-flight-battle-size__range";
  input.min = String(BATTLE_SHIP_HULL_SCALE_MIN);
  input.max = String(BATTLE_SHIP_HULL_SCALE_MAX);
  input.step = "0.002";
  input.value = String(BATTLE_SHIP_HULL_SCALE_DEFAULT);
  input.setAttribute("aria-valuemin", input.min);
  input.setAttribute("aria-valuemax", input.max);

  const readout = document.createElement("div");
  readout.className = "shard-flight-battle-size__value";

  const apply = (raw, notify = false) => {
    const h = Math.max(
      BATTLE_SHIP_HULL_SCALE_MIN,
      Math.min(BATTLE_SHIP_HULL_SCALE_MAX, Number(raw)),
    );
    input.value = String(h);
    readout.textContent = `${Math.round((h / BATTLE_SHIP_HULL_SCALE_MAX) * 100)}%`;
    if (notify) onChange(h);
  };

  input.addEventListener("input", () => apply(input.value, true));
  input.addEventListener("change", () => apply(input.value, true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  trackWrap.appendChild(input);
  root.appendChild(label);
  root.appendChild(trackWrap);
  root.appendChild(readout);
  apply(BATTLE_SHIP_HULL_SCALE_DEFAULT);

  return {
    root,
    setValue: (h) => apply(h, true),
    setVisualValue: (h) => {
      const clamped = Math.max(
        BATTLE_SHIP_HULL_SCALE_MIN,
        Math.min(BATTLE_SHIP_HULL_SCALE_MAX, h),
      );
      input.value = String(clamped);
      readout.textContent = `${Math.round((clamped / BATTLE_SHIP_HULL_SCALE_MAX) * 100)}%`;
    },
    contains: (el) => root.contains(el),
  };
}

/**
 * Live Newton II telemetry pinned to the left side of the canvas. Shows the
 * current thrust F, ship mass m, and the resulting acceleration a = F / m so
 * the pilot can see the equation that drives the ship update each frame.
 */
function createNewtonReadout() {
  const root = document.createElement("div");
  root.className = "shard-flight-newton";
  root.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "shard-flight-newton__title";
  title.textContent = "Newton II";

  const eqn = document.createElement("div");
  eqn.className = "shard-flight-newton__eqn";
  eqn.innerHTML =
    `<span class="shard-flight-newton__var">a</span> = ` +
    `<span class="shard-flight-newton__var">F</span> / ` +
    `<span class="shard-flight-newton__var">m</span>`;

  const rows = document.createElement("div");
  rows.className = "shard-flight-newton__rows";
  const fRow = buildNewtonRow("F", "N", "shard-flight-newton__row--f");
  const mRow = buildNewtonRow("m", "kg", "shard-flight-newton__row--m");
  const aRow = buildNewtonRow("a", "u/s²", "shard-flight-newton__row--a");
  const vRow = buildNewtonRow("v", "u/s", "shard-flight-newton__row--v");
  rows.appendChild(fRow.row);
  rows.appendChild(mRow.row);
  rows.appendChild(aRow.row);
  rows.appendChild(vRow.row);

  root.appendChild(title);
  root.appendChild(eqn);
  root.appendChild(rows);

  return {
    root,
    setValues({ thrust, mass, accel, speed }) {
      fRow.valEl.textContent = formatNewtonNumber(thrust);
      mRow.valEl.textContent = formatNewtonNumber(mass);
      aRow.valEl.textContent = formatNewtonNumber(accel);
      vRow.valEl.textContent = formatNewtonNumber(speed);
    },
  };
}

function buildNewtonRow(sym, unit, cls) {
  const row = document.createElement("div");
  row.className = `shard-flight-newton__row ${cls}`;
  const symEl = document.createElement("span");
  symEl.className = "shard-flight-newton__sym";
  symEl.textContent = sym;
  const valEl = document.createElement("span");
  valEl.className = "shard-flight-newton__val";
  valEl.textContent = "—";
  const unitEl = document.createElement("span");
  unitEl.className = "shard-flight-newton__unit";
  unitEl.textContent = unit;
  row.appendChild(symEl);
  row.appendChild(valEl);
  row.appendChild(unitEl);
  return { row, valEl };
}

function formatNewtonNumber(n) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
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
 * @param {() => void} [opts.onBattleToggle]
 * @param {(hullScale: number) => void} [opts.onBattleShipSizeChange]
 * @param {(throttle: number) => void} opts.onThrottleChange Manual override from dragging the slider.
 * @param {() => void} opts.onThrottlePress Pointer is held down on the canvas — gas pedal pressed.
 * @param {() => void} opts.onThrottleRelease Pointer was released (or capture lost / window blurred).
 */
export function createShardFlightHud(container, {
  isMobile,
  onStartFlight,
  onRestart,
  onExitFlight,
  onBattleToggle,
  onBattleShipSizeChange,
  onThrottleChange,
  onThrottlePress,
  onThrottleRelease,
}) {
  const root = document.createElement("div");
  root.className = "shard-flight-hud";

  const startLabel = "Shard flight";
  const exitLabel = "Exit shard flight";
  const battleLabel = "Battle";
  const endBattleLabel = "End battle";
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

  const battleBtn = document.createElement("button");
  battleBtn.type = "button";
  battleBtn.className = "shard-flight-btn shard-flight-btn--secondary";
  battleBtn.textContent = battleLabel;
  battleBtn.disabled = true;
  battleBtn.setAttribute("aria-label", "Start battle mode: frozen shards, reach the green goal");
  battleBtn.addEventListener("click", () => {
    if (battleBtn.disabled) return;
    onBattleToggle?.();
  });

  const btnRow = document.createElement("div");
  btnRow.className = "shard-flight-hud__btn-row";
  btnRow.appendChild(startBtn);
  btnRow.appendChild(battleBtn);
  root.appendChild(btnRow);

  const hint = document.createElement("div");
  hint.className = "shard-flight-hud__hint";
  hint.textContent =
    "W A S D steer · right-drag orbit cam · click & hold throttle · shards = game over";
  hint.setAttribute("aria-hidden", "true");
  root.appendChild(hint);

  const throttle = createThrottleControl((v) => onThrottleChange?.(v));
  container.appendChild(throttle.root);

  const battleSize = createBattleShipSizeControl((h) => onBattleShipSizeChange?.(h));
  container.appendChild(battleSize.root);

  const fuelGauge = createFuelGauge();
  throttle.root.appendChild(fuelGauge.root);

  const newton = createNewtonReadout();
  container.appendChild(newton.root);

  const gameOver = document.createElement("div");
  gameOver.className = "shard-flight-game-over";
  gameOver.setAttribute("role", "dialog");
  gameOver.setAttribute("aria-modal", "true");
  gameOver.setAttribute("aria-label", "Shard flight game over");

  const goTitle = document.createElement("div");
  goTitle.className = "shard-flight-game-over__title";
  goTitle.textContent = "Ship destroyed";
  gameOver.appendChild(goTitle);

  const goBtnRow = document.createElement("div");
  goBtnRow.className = "shard-flight-game-over__row";

  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "shard-flight-btn";
  restartBtn.textContent = "Restart";
  restartBtn.addEventListener("click", () => onRestart());
  goBtnRow.appendChild(restartBtn);

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "shard-flight-btn shard-flight-btn--secondary";
  exitBtn.textContent = "Exit flight";
  exitBtn.addEventListener("click", () => onExitFlight());
  goBtnRow.appendChild(exitBtn);

  gameOver.appendChild(goBtnRow);
  container.appendChild(gameOver);

  const victory = document.createElement("div");
  victory.className = "shard-flight-victory";
  victory.setAttribute("role", "dialog");
  victory.setAttribute("aria-modal", "true");
  victory.setAttribute("aria-label", "Battle won");

  const victoryTitle = document.createElement("div");
  victoryTitle.className = "shard-flight-victory__title";
  victoryTitle.textContent = "Goal reached";
  victory.appendChild(victoryTitle);

  const victoryHint = document.createElement("p");
  victoryHint.className = "shard-flight-victory__hint";
  victoryHint.textContent = "You made it through the frozen field without touching a shard.";
  victory.appendChild(victoryHint);

  const victoryRow = document.createElement("div");
  victoryRow.className = "shard-flight-game-over__row";

  const victoryRestartBtn = document.createElement("button");
  victoryRestartBtn.type = "button";
  victoryRestartBtn.className = "shard-flight-btn";
  victoryRestartBtn.textContent = "Play again";
  victoryRestartBtn.addEventListener("click", () => onRestart());
  victoryRow.appendChild(victoryRestartBtn);

  const victoryExitBtn = document.createElement("button");
  victoryExitBtn.type = "button";
  victoryExitBtn.className = "shard-flight-btn shard-flight-btn--secondary";
  victoryExitBtn.textContent = "Exit flight";
  victoryExitBtn.addEventListener("click", () => onExitFlight());
  victoryRow.appendChild(victoryExitBtn);

  victory.appendChild(victoryRow);
  container.appendChild(victory);

  // Throttle-pedal: pointerdown on the canvas (not on HUD elements) begins a "press" that the
  // game ramps the throttle up against, pointerup releases. We capture the pointer on the
  // container so the release fires even if the user drags off the canvas or off the window —
  // otherwise a quick mouse-out would leave the throttle stuck wide open.
  const isInteractiveTarget = (target) => {
    if (!(target instanceof Element)) return false;
    if (throttle.contains(target)) return true;
    if (battleSize.contains(target)) return true;
    if (gameOver.contains(target)) return true;
    if (victory.contains(target)) return true;
    if (target.closest("button, input, select, textarea, [data-shard-flight-ignore-press]")) {
      return true;
    }
    if (target.closest(".shard-flight-hud, .planet-switcher-hud, .enter-planet-hud, .camera-distance-hud, .bottom-left-hud, .auth-ui, .planet-interior-hud, .planet-mailing-panel")) {
      return true;
    }
    return false;
  };

  let activePressPointer = -1;
  const beginPress = (e) => {
    if (!active) return;
    if (e.button !== undefined && e.button !== 0) return; // primary mouse / touch only
    if (isInteractiveTarget(e.target)) return;
    if (throttle.isDragging()) return;
    if (activePressPointer !== -1) return;
    activePressPointer = e.pointerId;
    try { container.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    onThrottlePress?.();
  };
  const endPress = (e) => {
    if (activePressPointer === -1) return;
    if (e && e.pointerId !== undefined && e.pointerId !== activePressPointer) return;
    const id = activePressPointer;
    activePressPointer = -1;
    if (e && e.pointerId !== undefined) {
      try { container.releasePointerCapture(id); } catch { /* noop */ }
    }
    onThrottleRelease?.();
  };
  container.addEventListener("pointerdown", beginPress);
  container.addEventListener("pointerup", endPress);
  container.addEventListener("pointercancel", endPress);
  // Window blur / tab swap can drop pointer events on the floor; fail-safe release so the
  // throttle never sticks at 100%.
  window.addEventListener("blur", () => endPress(null));

  return {
    root,
    /** The caller is responsible for placing this in the DOM (e.g. alongside other corner controls). */
    flightButton: startBtn,
    setFlightHudActive(v) {
      hint.style.display = v && !isMobile ? "block" : "none";
      active = v;
      startBtn.textContent = v ? exitLabel : startLabel;
      startBtn.setAttribute("aria-label", v ? exitAria : startAria);
      battleBtn.disabled = !v || isMobile;
    },
    setBattleModeActive(v) {
      battleBtn.textContent = v ? endBattleLabel : battleLabel;
      hint.textContent = v
        ? "Battle — frozen shards · reach the green goal · adjust ship size (left)"
        : "W A S D steer · right-drag orbit cam · click & hold throttle · Battle for shard dodge";
    },
    setBattleShipSizeVisible(v) {
      battleSize.root.classList.toggle("shard-flight-battle-size--visible", !!v);
    },
    setBattleShipSizeVisual(h) {
      battleSize.setVisualValue(h);
    },
    setThrottleVisible(v) {
      throttle.root.classList.toggle("shard-flight-throttle--visible", !!v);
      newton.root.classList.toggle("shard-flight-newton--visible", !!v);
      if (!v) throttle.setValue(0);
    },
    /** Update the live F / m / a numbers on the Newton II panel. */
    setNewton(values) {
      newton.setValues(values);
    },
    /** Force the slider back to 0 without changing visibility (used on restart). */
    resetThrottle() {
      throttle.setValue(0);
    },
    /** Slide the thumb to track an externally-driven throttle (the click-and-hold ramp). */
    setThrottleVisualValue(v) {
      throttle.setVisualValue(v);
    },
    setFuelFraction(f) {
      fuelGauge.setFraction(f);
    },
    showGameOver() {
      gameOver.classList.add("shard-flight-game-over--visible");
    },
    hideGameOver() {
      gameOver.classList.remove("shard-flight-game-over--visible");
    },
    showVictory() {
      victory.classList.add("shard-flight-victory--visible");
    },
    hideVictory() {
      victory.classList.remove("shard-flight-victory--visible");
    },
    /** @type {HTMLButtonElement} */
    battleButton: battleBtn,
  };
}
