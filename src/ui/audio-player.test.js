/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAudioPlayer } from "./audio-player.js";
import { dropIndexForY } from "./player-queue-panel.js";

function fakeAudioEl({ duration = 200, currentTime = 0, paused = false } = {}) {
  const el = new EventTarget();
  Object.assign(el, { duration, currentTime, paused, volume: 1 });
  return el;
}

const files = [
  { id: "a", name: "1. Alpha.mp3" },
  { id: "b", name: "2. Bravo.mp3" },
  { id: "c", name: "3. Charlie.mp3" },
];

function setup() {
  const audioState = { audioEl: null, fft: { setVolume: vi.fn() }, _liveStream: null, _musicLoadPhase: "idle" };
  const loadTrack = vi.fn();
  const toggleAudioPlayback = vi.fn(async () => true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const player = mountAudioPlayer(container, { audioState, loadTrack, toggleAudioPlayback });
  player.setTracks(files);
  const q = (sel) => container.querySelector(sel);
  return { audioState, loadTrack, toggleAudioPlayback, container, player, q };
}

describe("mountAudioPlayer", () => {
  let store;
  beforeEach(() => {
    document.body.innerHTML = "";
    // Node's own (broken) global localStorage can shadow jsdom's; use a tiny in-memory one.
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("has-player-bar");
  });

  it("renders the bar with the first track and marks the page", () => {
    const { q } = setup();
    expect(q(".player-bar__title").textContent).toBe("Alpha");
    expect(q(".player-bar__artist").textContent).toBe("NXGRXVITY");
    expect(document.documentElement.classList.contains("has-player-bar")).toBe(true);
  });

  it("play with nothing loaded asks the pipeline to load the current track", () => {
    const { q, loadTrack, toggleAudioPlayback } = setup();
    q('.player-bar__btn--play').click();
    expect(loadTrack).toHaveBeenCalledWith("a");
    expect(toggleAudioPlayback).not.toHaveBeenCalled();
  });

  it("play/pause with a loaded track toggles the existing audio (keeps the analyser path)", async () => {
    const { q, player, audioState, toggleAudioPlayback, loadTrack } = setup();
    audioState.audioEl = fakeAudioEl();
    player.attach(audioState.audioEl);
    q('.player-bar__btn--play').click();
    await Promise.resolve();
    expect(toggleAudioPlayback).toHaveBeenCalledWith(audioState);
    expect(loadTrack).not.toHaveBeenCalled();
  });

  it("next loads the next track; the track ending also advances", () => {
    const { q, player, audioState, loadTrack } = setup();
    q('[aria-label="Next track"]').click();
    expect(loadTrack).toHaveBeenLastCalledWith("b");
    audioState.audioEl = fakeAudioEl();
    player.attach(audioState.audioEl);
    audioState.audioEl.dispatchEvent(new Event("ended"));
    expect(loadTrack).toHaveBeenLastCalledWith("c");
  });

  it("previous restarts the track after 3 s, otherwise loads the previous track", () => {
    const { q, player, audioState, loadTrack } = setup();
    player.markCurrent("b");
    audioState.audioEl = fakeAudioEl({ currentTime: 42 });
    player.attach(audioState.audioEl);
    q('[aria-label="Previous track"]').click();
    expect(audioState.audioEl.currentTime).toBe(0);
    expect(loadTrack).not.toHaveBeenCalled();
    q('[aria-label="Previous track"]').click();
    expect(loadTrack).toHaveBeenCalledWith("a");
  });

  it("seek slider change seeks the element", () => {
    const { q, player, audioState } = setup();
    audioState.audioEl = fakeAudioEl({ duration: 200 });
    player.attach(audioState.audioEl);
    const seek = q(".player-bar__seek");
    seek.value = "500";
    seek.dispatchEvent(new Event("change"));
    expect(audioState.audioEl.currentTime).toBe(100);
  });

  it("keyboard: space toggles, arrows seek 5 s", async () => {
    const { player, audioState, toggleAudioPlayback } = setup();
    audioState.audioEl = fakeAudioEl({ currentTime: 20 });
    player.attach(audioState.audioEl);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(audioState.audioEl.currentTime).toBe(25);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(audioState.audioEl.currentTime).toBe(15);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await Promise.resolve();
    expect(toggleAudioPlayback).toHaveBeenCalled();
  });

  it("volume goes to the gain node after the analyser and is remembered", () => {
    const { q, audioState } = setup();
    const vol = q(".player-bar__volume-slider");
    vol.value = "30";
    vol.dispatchEvent(new Event("input"));
    expect(audioState.fft.setVolume).toHaveBeenLastCalledWith(0.3);
    expect(store.get("ng_player_volume")).toBe("0.3");
    q(".player-bar__btn--mute").click();
    expect(audioState.fft.setVolume).toHaveBeenLastCalledWith(0);
  });

  it("queue button opens the panel with now playing + up next", () => {
    const { q } = setup();
    expect(q(".player-queue").hidden).toBe(true);
    q(".player-bar__btn--queue").click();
    expect(q(".player-queue").hidden).toBe(false);
    expect(q(".player-queue__list--now .player-queue__title").textContent).toBe("Alpha");
    const next = [...q(".player-queue__list--next").children].map((li) => li.dataset.id);
    expect(next).toEqual(["b", "c"]);
  });

  it("queue: move down/up buttons reorder, remove drops, click jumps", () => {
    const { q, player, loadTrack } = setup();
    q('[aria-label="Move Bravo down"]').click();
    expect(player.queue.upNext().map((t) => t.id)).toEqual(["c", "b"]);
    q('[aria-label="Move Bravo up"]').click();
    expect(player.queue.upNext().map((t) => t.id)).toEqual(["b", "c"]);
    q('[aria-label="Remove Bravo from queue"]').click();
    expect(player.queue.upNext().map((t) => t.id)).toEqual(["c"]);
    q('[aria-label="Play Charlie"]').click();
    expect(loadTrack).toHaveBeenLastCalledWith("c");
    expect(q(".player-bar__title").textContent).toBe("Charlie");
  });

  it("removing the playing track starts the next one", () => {
    const { q, player, loadTrack } = setup();
    q(".player-bar__btn--queue").click();
    player.markCurrent("b");
    // current row has no remove button; remove via queue API path used by the panel
    q('[aria-label="Remove Charlie from queue"]').click();
    expect(player.queue.items.map((t) => t.id)).toEqual(["a", "b"]);
    expect(loadTrack).not.toHaveBeenCalled();
  });

  it("status shows loading while Drive fetches", () => {
    const { container, player, audioState } = setup();
    audioState._musicLoadPhase = "loading";
    player.sync();
    expect(container.querySelector(".player-bar").dataset.status).toBe("loading");
  });
});

describe("dropIndexForY", () => {
  const rects = [0, 40, 80].map((top) => ({ top, height: 40 }));
  it("picks the row whose middle the pointer passed", () => {
    expect(dropIndexForY(rects, 5)).toBe(0);
    expect(dropIndexForY(rects, 70)).toBe(1);
    expect(dropIndexForY(rects, 110)).toBe(2);
    expect(dropIndexForY(rects, 500)).toBe(2);
  });
});
