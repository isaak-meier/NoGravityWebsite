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

  const _ndc = new THREE.Vector3();

  return {
    root,
    setAimDotVisible(v) {
      aimDot.style.display = v ? "block" : "none";
      hint.style.display = v && !isMobile ? "block" : "none";
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
