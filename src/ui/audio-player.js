import { createPlayQueue, driveFileToTrack } from "../audio/play-queue.js";
import {
  SEEK_STEP_SEC,
  clampSeek,
  clampVolume,
  fractionToTime,
  keyToPlayerAction,
  playerStatus,
  prevAction,
} from "../audio/player-state.js";
import { createPlayerBar } from "./player-bar.js";
import { createQueuePanel } from "./player-queue-panel.js";

const VOLUME_KEY = "ng_player_volume";

function readSavedVolume() {
  try {
    const raw = window.localStorage?.getItem(VOLUME_KEY);
    return raw == null ? 1 : clampVolume(raw);
  } catch {
    return 1;
  }
}

function saveVolume(v) {
  try { window.localStorage?.setItem(VOLUME_KEY, String(v)); } catch { /* private mode */ }
}

/** Apply volume after the analyser (gain node) so the visuals keep the full signal. */
function applyVolume(audioState, v) {
  if (audioState.fft?.setVolume) audioState.fft.setVolume(v);
  else if (audioState.audioEl) audioState.audioEl.volume = v;
}

/**
 * Persistent bottom player bar + queue panel wired to the site's audio pipeline.
 * The player never creates its own audio: it asks `loadTrack(id)` (Drive → AudioFFT)
 * to load, and drives the element that the pipeline puts in `audioState.audioEl`.
 *
 * @param {HTMLElement} container
 * @param {{ audioState: object, loadTrack: (id: string) => Promise<void> | void,
 *   toggleAudioPlayback: (s: object) => Promise<boolean>, onPlaybackChange?: () => void }} deps
 */
export function mountAudioPlayer(container, { audioState, loadTrack, toggleAudioPlayback, onPlaybackChange }) {
  const queue = createPlayQueue();
  let volume = readSavedVolume();
  let attachedEl = null;
  /** @type {() => void} */
  let detachEl = () => {};

  const playTrack = (track) => {
    if (!track) return;
    render();
    void loadTrack(track.id);
  };
  const actions = createPlayerActions({ queue, audioState, playTrack, toggleAudioPlayback, onPlaybackChange, render: () => render() });

  const bar = createPlayerBar({
    onPlayPause: actions.playPause,
    onPrev: actions.prev,
    onNext: actions.next,
    onSeek: (f) => actions.seekTo(fractionToTime(f, audioState.audioEl?.duration)),
    onVolume: (v) => setVolume(v),
    onToggleQueue: () => setQueueOpen(!panel.isOpen()),
  });
  const panel = createQueuePanel({
    ...queueEditHandlers(queue, playTrack, () => render()),
    onClose: () => setQueueOpen(false),
  });

  function setQueueOpen(open) {
    panel.setOpen(open);
    bar.setQueueOpen(open);
    if (!open) bar.queueButton.focus({ preventScroll: true });
  }

  function setVolume(v) {
    volume = clampVolume(v);
    applyVolume(audioState, volume);
    bar.setVolume(volume);
    saveVolume(volume);
  }

  function render() {
    const el = audioState.audioEl;
    bar.setTrack(queue.current());
    bar.setStatus(playerStatus({
      loading: audioState._musicLoadPhase === "loading",
      error: audioState._musicLoadPhase === "error",
      hasAudio: !!el && !audioState._liveStream,
      paused: !el || el.paused,
    }));
    bar.setTime(el?.currentTime ?? 0, el?.duration ?? 0);
    panel.render({ current: queue.current(), upNext: queue.upNext() });
  }

  function attach(el) {
    if (el === attachedEl) return;
    detachEl();
    attachedEl = el;
    applyVolume(audioState, volume);
    detachEl = el
      ? bindElementEvents(el, {
        onTime: () => bar.setTime(el.currentTime, el.duration),
        onState: () => render(),
        onEnded: () => actions.next(),
      })
      : () => {};
    render();
  }

  bindPlayerKeys(actions);
  container.append(bar.root, panel.root);
  document.documentElement.classList.add("has-player-bar");
  bar.setVolume(volume);
  render();

  return {
    root: bar.root,
    queue,
    /** New Drive listing → queue (keeps the current track if still listed). */
    setTracks(files) {
      queue.setTracks((files ?? []).map(driveFileToTrack));
      render();
    },
    /** The pipeline just loaded `audioState.audioEl`. */
    attach: (el) => attach(el),
    /** Load phase / live mic / cockpit toggle changed. */
    sync: () => render(),
    /** Mark `id` as current without loading (e.g. the pipeline's autoplay picked it). */
    markCurrent(id) {
      queue.jumpTo(id);
      render();
    },
  };
}

/** Listen to the pipeline's audio element; returns an unbind function. */
function bindElementEvents(el, { onTime, onState, onEnded }) {
  const events = [["timeupdate", onTime], ["durationchange", onTime], ["loadedmetadata", onTime],
    ["play", onState], ["pause", onState], ["ended", onEnded]];
  for (const [type, fn] of events) el.addEventListener(type, fn);
  return () => { for (const [type, fn] of events) el.removeEventListener(type, fn); };
}

/** Queue panel edits. `from`/`to` are indices within "up next". */
function queueEditHandlers(queue, playTrack, render) {
  return {
    onJump: (id) => playTrack(queue.jumpTo(id)),
    onRemove: (id) => {
      const { wasCurrent } = queue.remove(id);
      if (wasCurrent) playTrack(queue.current());
      render();
    },
    onMove: (from, to) => {
      const base = queue.index + 1;
      if (queue.move(base + from, base + Math.max(0, to))) render();
    },
  };
}

/** Play/pause, prev, next and seek on top of the queue + audio pipeline. */
function createPlayerActions({ queue, audioState, playTrack, toggleAudioPlayback, onPlaybackChange, render }) {
  const hasFileAudio = () => !!audioState.audioEl && !audioState._liveStream;
  const seekTo = (t) => {
    const el = audioState.audioEl;
    if (!el || audioState._liveStream) return;
    el.currentTime = clampSeek(t, el.duration);
    render();
  };
  return {
    seekTo,
    seekBy: (delta) => seekTo((audioState.audioEl?.currentTime ?? 0) + delta),
    async playPause() {
      if (!hasFileAudio()) return playTrack(queue.current());
      try {
        await toggleAudioPlayback(audioState);
      } catch (err) {
        console.warn("Player play/pause failed:", err);
      }
      onPlaybackChange?.();
      render();
    },
    next: () => playTrack(queue.next()),
    prev() {
      if (hasFileAudio() && prevAction(audioState.audioEl.currentTime) === "restart") return seekTo(0);
      playTrack(queue.prev());
    },
  };
}

/** Space = play/pause, ← / → = seek 5 s. Skips typing fields, sliders and focused buttons. */
function bindPlayerKeys(actions) {
  window.addEventListener("keydown", (e) => {
    const action = keyToPlayerAction(e);
    if (!action) return;
    e.preventDefault();
    if (action === "toggle") void actions.playPause();
    else actions.seekBy(action === "seekBack" ? -SEEK_STEP_SEC : SEEK_STEP_SEC);
  });
}
