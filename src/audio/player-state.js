/**
 * Small pure helpers for the site player: time labels, seek math, volume and
 * keyboard shortcuts. No DOM or audio here so they can be unit tested.
 */

export const SEEK_STEP_SEC = 5;
/** "Previous" restarts the current track if we are past this many seconds. */
export const PREV_RESTART_AFTER_SEC = 3;

/**
 * @param {number} sec
 * @returns {string} m:ss (or h:mm:ss), "0:00" for bad input
 */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Clamp a seek target into [0, duration]. Unknown duration → only clamp at 0. */
export function clampSeek(t, duration) {
  const target = Number.isFinite(t) ? Math.max(0, t) : 0;
  return Number.isFinite(duration) && duration > 0 ? Math.min(target, duration) : target;
}

/** Seek target for a 0..1 fraction of the track (progress bar click/drag). */
export function fractionToTime(fraction, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return f * duration;
}

/** 0..1 progress for the bar. */
export function progressFraction(position, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(1, position / duration));
}

export function clampVolume(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/**
 * What "previous" should do: restart the track when we are a few seconds in,
 * otherwise go to the previous track.
 * @returns {'restart' | 'previous'}
 */
export function prevAction(position) {
  return Number.isFinite(position) && position > PREV_RESTART_AFTER_SEC ? "restart" : "previous";
}

/**
 * Player status for the UI.
 * @param {{ loading?: boolean, error?: boolean, hasAudio?: boolean, paused?: boolean }} s
 * @returns {'loading' | 'error' | 'idle' | 'paused' | 'playing'}
 */
export function playerStatus({ loading, error, hasAudio, paused }) {
  if (loading) return "loading";
  if (error) return "error";
  if (!hasAudio) return "idle";
  return paused ? "paused" : "playing";
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Map a keydown to a player action. Ignores typing fields, sliders, buttons
 * (space on a focused button already clicks it) and modifier combos.
 * @param {{ key: string, target?: any, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, defaultPrevented?: boolean }} e
 * @returns {'toggle' | 'seekBack' | 'seekForward' | null}
 */
export function keyToPlayerAction(e) {
  if (!e || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return null;
  const t = e.target;
  if (t && (TYPING_TAGS.has(t.tagName) || t.isContentEditable)) return null;
  const role = t?.getAttribute?.("role");
  if (role === "slider" || role === "textbox") return null;
  if (e.key === " " || e.key === "Spacebar") {
    return t?.tagName === "BUTTON" ? null : "toggle";
  }
  if (e.key === "ArrowLeft") return "seekBack";
  if (e.key === "ArrowRight") return "seekForward";
  return null;
}
