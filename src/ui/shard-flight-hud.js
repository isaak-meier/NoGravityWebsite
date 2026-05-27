import * as THREE from "three";

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {boolean} opts.isMobile
 * @param {() => void} opts.onStartFlight
 * @param {() => void} opts.onRestart
 * @param {() => void} opts.onExitFlight
 */
export function createShardFlightHud(container, {
  isMobile,
  onStartFlight,
  onRestart,
  onExitFlight,
}) {
  const root = document.createElement("div");
  root.className = "shard-flight-hud";

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "shard-flight-btn";
  startBtn.textContent = "Shard flight";
  startBtn.setAttribute(
    "aria-label",
    "Start shard flight mini-game: third-person ship around the shard field",
  );
  if (isMobile) {
    startBtn.disabled = true;
    startBtn.title = "Shard flight is desktop only for now";
    startBtn.setAttribute("aria-disabled", "true");
  }
  startBtn.addEventListener("click", () => {
    if (!startBtn.disabled) onStartFlight();
  });
  root.appendChild(startBtn);

  const hint = document.createElement("div");
  hint.className = "shard-flight-hud__hint";
  hint.textContent = "W A S D moves the aim dot; fly into shards = game over";
  hint.setAttribute("aria-hidden", "true");
  root.appendChild(hint);

  const aimDot = document.createElement("div");
  aimDot.className = "shard-flight-hud__aim-dot";
  aimDot.setAttribute("aria-hidden", "true");
  container.appendChild(aimDot);

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

  const telemetry = document.createElement("div");
  telemetry.className = "shard-flight-telemetry";
  telemetry.setAttribute("aria-live", "off");
  telemetry.style.display = "none";
  const titleEl = document.createElement("div");
  titleEl.className = "shard-flight-telemetry__title";
  titleEl.textContent = "Flight camera";
  telemetry.appendChild(titleEl);
  const rowEls = {};
  for (const key of ["pos", "delta", "dist", "ship", "peak"]) {
    const row = document.createElement("div");
    row.className = "shard-flight-telemetry__row";
    row.dataset.row = key;
    row.textContent = "—";
    telemetry.appendChild(row);
    rowEls[key] = row;
  }
  container.appendChild(telemetry);

  const _ndc = new THREE.Vector3();

  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
  const fmtSigned = (n) => {
    if (!Number.isFinite(n)) return "—";
    const s = n >= 0 ? "+" : "";
    return s + n.toFixed(2);
  };

  return {
    root,
    setAimDotVisible(v) {
      aimDot.style.display = v ? "block" : "none";
      hint.style.display = v && !isMobile ? "block" : "none";
      telemetry.style.display = v ? "block" : "none";
    },
    /**
     * @param {object} t
     * @param {import('three').Vector3} t.camPos
     * @param {import('three').Vector3} t.camDelta
     * @param {number} t.camMove
     * @param {number} t.peakMove
     * @param {number} t.distPlanet
     * @param {number} t.distShip
     * @param {number} t.distAim
     * @param {import('three').Vector3} t.shipPos
     * @param {number} t.shipSpeed
     * @param {boolean} t.flightEngaged
     */
    syncTelemetry(t) {
      if (telemetry.style.display === "none") return;
      rowEls.pos.textContent =
        `pos  x ${fmt(t.camPos.x)}  y ${fmt(t.camPos.y)}  z ${fmt(t.camPos.z)}`;
      rowEls.delta.textContent =
        `Δfr  x ${fmtSigned(t.camDelta.x)}  y ${fmtSigned(t.camDelta.y)}  z ${fmtSigned(t.camDelta.z)}  |Δ| ${fmt(t.camMove)}`;
      rowEls.dist.textContent =
        `dist planet ${fmt(t.distPlanet)}  ship ${fmt(t.distShip)}  aim ${fmt(t.distAim)}`;
      rowEls.ship.textContent =
        `ship x ${fmt(t.shipPos.x)}  y ${fmt(t.shipPos.y)}  z ${fmt(t.shipPos.z)}  spd ${fmt(t.shipSpeed)}`;
      rowEls.peak.textContent =
        `peak |Δ| ${fmt(t.peakMove)}  mode ${t.flightEngaged ? "chase" : "entry"}`;
    },
    /**
     * @param {import('three').Camera} camera
     * @param {import('three').Vector3} aimWorld
     * @param {HTMLElement} el
     */
    syncAimDot(camera, aimWorld, el) {
      if (aimDot.style.display === "none") return;
      camera.updateMatrixWorld();
      _ndc.copy(aimWorld).project(camera);
      if (_ndc.z > 1) {
        aimDot.style.visibility = "hidden";
        return;
      }
      aimDot.style.visibility = "visible";
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
