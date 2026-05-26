import { showCockpitToast } from "./cockpit-toast.js";
import { isOffline } from "../util/is-offline.js";

/**
 * @param {HTMLElement} container - usually bottom HUD or `#three-container`
 * @param {{ pyramidField: { config: { shatterSubsystemEnabled: boolean }, triggerManualShatter: () => void }, audioState: object, toggleAudioPlayback: (s: object) => Promise<boolean>, solarSystem?: { setGraphLaserManualOverride: (m: 'on'|'off'|null) => void, getGraphLaserManualOverride: () => 'on'|'off'|null } }} targets
 */
export function mountScreenDials(container, { pyramidField, audioState, toggleAudioPlayback, solarSystem }) {
  const root = document.createElement("div");
  root.className = "screen-dials";
  root.setAttribute("aria-label", "Performance controls");

  const { row: musicRow, syncMusicToggle, syncMicToggle, micBtn } = buildAudioInputRow(
    audioState,
    toggleAudioPlayback,
  );
  root.appendChild(musicRow);

  if (solarSystem?.setGraphLaserManualOverride && solarSystem?.getGraphLaserManualOverride) {
    const { row: laserRow } = buildGraphLaserModeRow(solarSystem);
    root.appendChild(laserRow);
  }

  const { row: shatterTriggerRow, syncShatterSubsystemUi } = buildShatterTriggerRow(
    pyramidField,
    solarSystem
  );
  root.appendChild(shatterTriggerRow);

  syncShatterSubsystemUi();
  container.appendChild(root);
  return { domElement: root, syncMusicToggle, syncMicToggle, micBtn };
}

function makeCockpitToggle(ariaLabel) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cockpit-toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-label", ariaLabel);
  const track = document.createElement("span");
  track.className = "cockpit-toggle__track";
  const thumb = document.createElement("span");
  thumb.className = "cockpit-toggle__thumb";
  btn.appendChild(track);
  btn.appendChild(thumb);
  return btn;
}

function buildShatterTriggerRow(pyramidField, solarSystem) {
  const shatterTriggerRow = document.createElement("div");
  shatterTriggerRow.className = "screen-dial screen-dial--shatter-trigger gui-knob-row";

  const shatterName = document.createElement("div");
  shatterName.className = "screen-dial__name lil-name";
  shatterName.textContent = "Shatter";

  const shatterWidget = document.createElement("div");
  shatterWidget.className = "screen-dial__widget lil-widget";

  const triggerBtn = document.createElement("button");
  triggerBtn.type = "button";
  triggerBtn.className = "cockpit-shatter-btn";
  triggerBtn.setAttribute("aria-label", "Trigger shatter effect");
  triggerBtn.textContent = "Trigger";
  shatterWidget.appendChild(triggerBtn);
  shatterTriggerRow.appendChild(shatterName);
  shatterTriggerRow.appendChild(shatterWidget);

  const usePlanetShatter = typeof solarSystem?.triggerRedPlanetShatter === "function";

  function syncShatterSubsystemUi() {
    const enabled = usePlanetShatter || !!pyramidField.config.shatterSubsystemEnabled;
    shatterTriggerRow.classList.toggle("screen-dial--shatter-sub-off", !enabled);
    triggerBtn.disabled = !enabled;
  }

  triggerBtn.addEventListener("click", () => {
    if (usePlanetShatter) {
      solarSystem.triggerRedPlanetShatter();
    } else {
      pyramidField.triggerManualShatter();
    }
  });

  return { row: shatterTriggerRow, syncShatterSubsystemUi };
}

/**
 * Toast copy when music is unavailable (offline, server unreachable, or load failed).
 * Returns null when playback is possible or the user should pick a track instead.
 * @param {{
 *   audioEl?: HTMLMediaElement | null,
 *   _liveStream?: unknown,
 *   _musicLoadPhase?: string,
 *   _musicLoadOffline?: boolean,
 *   _musicDriveConfigured?: boolean,
 *   _musicLoadEmptyFolder?: boolean,
 * }} audioState
 * @returns {string | null}
 */
export function getMusicUnavailableToastMessage(audioState) {
  if (audioState._liveStream) {
    return "Live mic — file music unavailable";
  }

  const phase = audioState._musicLoadPhase || "idle";
  if (phase === "loading") return null;
  if (phase === "error") {
    return audioState._musicLoadOffline
      ? "You're offline — music needs a connection"
      : "Couldn't load track — try again";
  }

  if (audioState.audioEl) return null;

  if (audioState._musicLoadEmptyFolder) {
    return "No audio files in Drive folder";
  }

  const offline = isOffline();
  if (offline) {
    return "You're offline — music needs a connection";
  }

  if (audioState._musicDriveConfigured) {
    return null;
  }

  return "Music unavailable — connect to load a track";
}

/**
 * Music + mic switches in one cockpit panel (mic wired from three-scene.js).
 */
function buildAudioInputRow(audioState, toggleAudioPlayback) {
  const row = document.createElement("div");
  row.className = "screen-dial screen-dial--music gui-knob-row";

  const mainRow = document.createElement("div");
  mainRow.className = "screen-dial__main-row screen-dial__main-row--audio";

  const musicControl = document.createElement("div");
  musicControl.className = "screen-dial__control screen-dial__control--music";
  const musicName = document.createElement("div");
  musicName.className = "screen-dial__name lil-name";
  musicName.textContent = "Music";
  const musicBtn = makeCockpitToggle("Music playback");
  musicControl.appendChild(musicName);
  musicControl.appendChild(musicBtn);

  const micControl = document.createElement("div");
  micControl.className = "screen-dial__control screen-dial__control--mic";
  const micName = document.createElement("div");
  micName.className = "screen-dial__name lil-name";
  micName.textContent = "Mic";
  const micBtn = makeCockpitToggle("Microphone input");
  micBtn.title = "Use microphone as live audio input";
  micControl.appendChild(micName);
  micControl.appendChild(micBtn);

  mainRow.appendChild(musicControl);
  mainRow.appendChild(micControl);
  row.appendChild(mainRow);

  const syncMusicToggle = wireMusicToggle(audioState, row, musicBtn, toggleAudioPlayback);

  function syncMicToggle() {
    const live = !!audioState._liveStream;
    micBtn.setAttribute("aria-checked", String(live));
    micControl.classList.toggle("screen-dial__control--mic-on", live);
  }

  syncMicToggle();
  return { row, syncMusicToggle, syncMicToggle, micBtn };
}

/**
 * Auto = music-driven lasers; On/Off = user override.
 * @param {{ setGraphLaserManualOverride: (m: 'on'|'off'|null) => void, getGraphLaserManualOverride: () => 'on'|'off'|null }} solarSystem
 */
function buildGraphLaserModeRow(solarSystem) {
  const row = document.createElement("div");
  row.className = "screen-dial screen-dial--graph-lasers gui-knob-row";

  const name = document.createElement("div");
  name.className = "screen-dial__name lil-name";
  name.textContent = "Lasers";

  const widget = document.createElement("div");
  widget.className = "screen-dial__widget lil-widget";

  const sel = document.createElement("select");
  sel.className = "cockpit-pattern-select cockpit-graph-laser-select";
  sel.setAttribute(
    "aria-label",
    "Graph lasers: Auto follows the track; On keeps beams visible; Off hides them",
  );
  sel.append(new Option("Auto", "auto"), new Option("On", "on"), new Option("Off", "off"));

  function syncFromSolarSystem() {
    const m = solarSystem.getGraphLaserManualOverride();
    sel.value = m === "on" ? "on" : m === "off" ? "off" : "auto";
  }

  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === "on") solarSystem.setGraphLaserManualOverride("on");
    else if (v === "off") solarSystem.setGraphLaserManualOverride("off");
    else solarSystem.setGraphLaserManualOverride(null);
  });

  widget.appendChild(sel);
  row.appendChild(name);
  row.appendChild(widget);
  syncFromSolarSystem();
  return { row };
}

function wireMusicToggle(audioState, row, btn, toggleAudioPlayback) {
  let hookedEl = null;

  function syncMusicToggle() {
    const el = audioState.audioEl;
    const live = !!audioState._liveStream;
    const hasTrack = !!el && !live;
    const loading = (audioState._musicLoadPhase || "idle") === "loading";
    btn.disabled = loading;
    row.classList.toggle("screen-dial--music-off", hasTrack && el.paused);

    if (hasTrack) {
      btn.setAttribute("aria-checked", String(!el.paused));
    } else {
      btn.setAttribute("aria-checked", "false");
    }

    if (el !== hookedEl) {
      if (hookedEl) {
        hookedEl.removeEventListener("play", syncMusicToggle);
        hookedEl.removeEventListener("pause", syncMusicToggle);
      }
      hookedEl = el;
      if (hookedEl) {
        hookedEl.addEventListener("play", syncMusicToggle);
        hookedEl.addEventListener("pause", syncMusicToggle);
      }
    }
  }

  btn.addEventListener("click", async () => {
    if (audioState._liveStream) {
      const msg = getMusicUnavailableToastMessage(audioState);
      if (msg) showCockpitToast(msg, { assertive: true });
      return;
    }
    if (audioState.audioEl) {
      try {
        await toggleAudioPlayback(audioState);
      } catch (err) {
        console.warn("Music toggle failed:", err);
      }
      syncMusicToggle();
      return;
    }
    const msg = getMusicUnavailableToastMessage(audioState);
    if (msg) showCockpitToast(msg, { assertive: true });
  });

  syncMusicToggle();
  return syncMusicToggle;
}
