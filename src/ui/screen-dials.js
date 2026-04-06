/**
 * @param {HTMLElement} container - usually bottom HUD or `#three-container`
 * @param {{ pyramidField: { config: { shatterSubsystemEnabled: boolean }, triggerManualShatter: () => void }, audioState: object, toggleAudioPlayback: (s: object) => Promise<boolean> }} targets
 */
export function mountScreenDials(container, { pyramidField, audioState, toggleAudioPlayback }) {
  const root = document.createElement("div");
  root.className = "screen-dials";
  root.setAttribute("aria-label", "Performance controls");

  const { row: musicRow, syncMusicToggle } = buildMusicToggle(audioState, toggleAudioPlayback);
  root.appendChild(musicRow);

  const { row: shatterTriggerRow, syncShatterSubsystemUi } = buildShatterTriggerRow(pyramidField);
  root.appendChild(shatterTriggerRow);

  syncShatterSubsystemUi();
  container.appendChild(root);
  return { domElement: root, syncMusicToggle };
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

function buildShatterTriggerRow(pyramidField) {
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

  function syncShatterSubsystemUi() {
    const enabled = !!pyramidField.config.shatterSubsystemEnabled;
    shatterTriggerRow.classList.toggle("screen-dial--shatter-sub-off", !enabled);
    triggerBtn.disabled = !enabled;
  }

  triggerBtn.addEventListener("click", () => {
    pyramidField.triggerManualShatter();
  });

  return { row: shatterTriggerRow, syncShatterSubsystemUi };
}

/**
 * File-based music on/off (same panel chrome as dials). Disabled when no track or when live input is active.
 */
function buildMusicToggle(audioState, toggleAudioPlayback) {
  const row = document.createElement("div");
  row.className = "screen-dial screen-dial--music gui-knob-row";

  const name = document.createElement("div");
  name.className = "screen-dial__name lil-name";
  name.textContent = "Music";

  const widget = document.createElement("div");
  widget.className = "screen-dial__widget lil-widget";

  const btn = makeCockpitToggle("Music playback");

  widget.appendChild(btn);
  row.appendChild(name);
  row.appendChild(widget);

  const syncMusicToggle = wireMusicToggle(audioState, row, btn, toggleAudioPlayback);
  return { row, syncMusicToggle };
}

function wireMusicToggle(audioState, row, btn, toggleAudioPlayback) {
  let hookedEl = null;

  function syncMusicToggle() {
    const el = audioState.audioEl;
    const live = !!audioState._liveStream;
    const hasTrack = !!el && !live;
    btn.disabled = !hasTrack;
    row.classList.toggle("screen-dial--music-off", hasTrack && el.paused);
    row.classList.toggle("screen-dial--music-live", live);

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
    if (!audioState.audioEl || audioState._liveStream) return;
    try {
      await toggleAudioPlayback(audioState);
    } catch (err) {
      console.warn("Music toggle failed:", err);
    }
    syncMusicToggle();
  });

  syncMusicToggle();
  return syncMusicToggle;
}
