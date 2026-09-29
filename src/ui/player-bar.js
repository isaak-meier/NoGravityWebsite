import { formatTime, progressFraction } from "../audio/player-state.js";

/** Inline icons (currentColor) so the bar needs no image files. */
const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM9.5 12 19 5v14z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM14.5 12 5 19V5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-2V8l5 3z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zm12 .4L17.4 8 20 10.6 22.6 8 24 9.4 21.4 12l2.6 2.6-1.4 1.4-2.6-2.6-2.6 2.6-1.4-1.4 2.6-2.6z"/></svg>',
};

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function iconButton(name, label, extraClass = "") {
  const btn = el("button", `player-bar__btn ${extraClass}`.trim(), { type: "button", "aria-label": label, title: label });
  btn.innerHTML = ICONS[name];
  return btn;
}

function buildTrackInfo() {
  const wrap = el("div", "player-bar__track");
  const art = el("div", "player-bar__art", { "aria-hidden": "true" });
  const meta = el("div", "player-bar__meta");
  const title = el("div", "player-bar__title");
  const artist = el("div", "player-bar__artist");
  title.textContent = "Loading music…";
  artist.textContent = "NXGRXVITY";
  meta.append(title, artist);
  wrap.append(art, meta);
  return { wrap, art, title, artist };
}

/** Seek slider + elapsed/total labels. Emits onSeek(fraction) on release, previews while dragging. */
function buildProgress(onSeek) {
  const wrap = el("div", "player-bar__progress");
  const elapsed = el("span", "player-bar__time player-bar__time--elapsed");
  const total = el("span", "player-bar__time player-bar__time--total");
  const seek = el("input", "player-bar__seek", {
    type: "range", min: "0", max: "1000", step: "1", value: "0", "aria-label": "Seek",
  });
  elapsed.textContent = "0:00";
  total.textContent = "0:00";
  wrap.append(elapsed, seek, total);

  let dragging = false;
  let duration = 0;
  const paintFill = (f) => seek.style.setProperty("--fill", `${(f * 100).toFixed(2)}%`);
  seek.addEventListener("input", () => {
    dragging = true;
    const f = Number(seek.value) / 1000;
    paintFill(f);
    elapsed.textContent = formatTime(f * duration);
  });
  seek.addEventListener("change", () => {
    dragging = false;
    onSeek(Number(seek.value) / 1000);
  });

  function setTime(position, dur) {
    duration = Number.isFinite(dur) ? dur : 0;
    total.textContent = formatTime(duration);
    seek.setAttribute("aria-valuetext", `${formatTime(position)} of ${formatTime(duration)}`);
    if (dragging) return;
    const f = progressFraction(position, duration);
    seek.value = String(Math.round(f * 1000));
    paintFill(f);
    elapsed.textContent = formatTime(position);
  }
  return { wrap, seek, setTime };
}

function buildVolume(onVolume) {
  const wrap = el("div", "player-bar__volume");
  const muteBtn = iconButton("volume", "Mute", "player-bar__btn--mute");
  const slider = el("input", "player-bar__volume-slider", {
    type: "range", min: "0", max: "100", step: "1", value: "100", "aria-label": "Volume",
  });
  wrap.append(muteBtn, slider);
  let lastNonZero = 1;
  slider.addEventListener("input", () => onVolume(Number(slider.value) / 100));
  muteBtn.addEventListener("click", () => {
    const v = Number(slider.value) / 100;
    onVolume(v > 0 ? 0 : lastNonZero);
  });
  function setVolume(v) {
    if (v > 0) lastNonZero = v;
    slider.value = String(Math.round(v * 100));
    slider.style.setProperty("--fill", `${Math.round(v * 100)}%`);
    muteBtn.innerHTML = v > 0 ? ICONS.volume : ICONS.muted;
    muteBtn.setAttribute("aria-label", v > 0 ? "Mute" : "Unmute");
  }
  return { wrap, setVolume };
}

/**
 * Bottom-docked player bar (Spotify-style): track info, prev/play/next, seek, queue toggle, volume.
 * @param {{ onPlayPause: () => void, onPrev: () => void, onNext: () => void,
 *   onSeek: (fraction: number) => void, onVolume: (v: number) => void, onToggleQueue: () => void }} handlers
 */
export function createPlayerBar(handlers) {
  const root = el("div", "player-bar", { role: "region", "aria-label": "Music player" });
  const info = buildTrackInfo();
  const center = el("div", "player-bar__center");
  const buttons = el("div", "player-bar__buttons");
  const prevBtn = iconButton("prev", "Previous track");
  const playBtn = iconButton("play", "Play", "player-bar__btn--play");
  const nextBtn = iconButton("next", "Next track");
  buttons.append(prevBtn, playBtn, nextBtn);
  const progress = buildProgress(handlers.onSeek);
  center.append(buttons, progress.wrap);
  const right = el("div", "player-bar__right");
  const queueBtn = iconButton("queue", "Queue", "player-bar__btn--queue");
  queueBtn.setAttribute("aria-expanded", "false");
  const volume = buildVolume(handlers.onVolume);
  right.append(queueBtn, volume.wrap);
  root.append(info.wrap, center, right);

  prevBtn.addEventListener("click", () => handlers.onPrev());
  playBtn.addEventListener("click", () => handlers.onPlayPause());
  nextBtn.addEventListener("click", () => handlers.onNext());
  queueBtn.addEventListener("click", () => handlers.onToggleQueue());

  return {
    root,
    queueButton: queueBtn,
    setTrack(track) {
      info.title.textContent = track?.title ?? "No track";
      info.artist.textContent = track?.artist ?? "NXGRXVITY";
      info.art.style.backgroundImage = track?.artworkUrl ? `url("${track.artworkUrl}")` : "";
    },
    /** @param {'loading'|'error'|'idle'|'paused'|'playing'} status */
    setStatus(status) {
      const playing = status === "playing";
      playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      playBtn.title = playing ? "Pause" : "Play";
      root.dataset.status = status;
    },
    setTime: progress.setTime,
    setVolume: volume.setVolume,
    setQueueOpen(open) {
      queueBtn.setAttribute("aria-expanded", String(open));
      queueBtn.classList.toggle("player-bar__btn--active", open);
    },
  };
}
