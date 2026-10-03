// simple feature flag manager
// flags can be toggled at runtime via setFlag (useful for tests) or
// configured based on environment variables during build.

/**
 * Hidden entry for the shard flight mini-game: only on when the page URL has `?game`
 * (e.g. https://nxgrxvity.com/?game). Regular visitors never see it.
 * @param {string} [search]
 * @returns {boolean}
 */
export function hasGameUrlParam(search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    return new URLSearchParams(search).has("game");
  } catch {
    return false;
  }
}

const GAME_URL = hasGameUrlParam();

const FLAGS = {
  // Always on so production deploys match dev (no NODE_ENV gating).
  // Tests can still call setFlag to simulate disabled state.
  ENABLE_GUI: true,
  ENABLE_UPLOAD: true,
  /** Dev: first frame starts comet orbit follow (same controls as planet). Off = normal planet camera. */
  COMET_DEV_INSPECT_ON_LOAD: false,
  /**
   * Dev: lock camera to the Red planet on load with no 5s intro orbit zoom-in.
   * Turn off before shipping (Blue at origin remains {@link SolarSystem#primary} for pyramids / HUD).
   */
  DEV_START_ON_RED_PLANET: true,
  /**
   * First Google Drive track loads and plays on load when a folder is configured.
   * Off in game mode (`?game`), matching the shard-flight branch; on for the normal site.
   */
  AUTOPLAY_FIRST_DRIVE_TRACK_ON_LOAD: !GAME_URL,
  /**
   * Shard flight mini-game (HUD + "Shard flight" button in the View panel), for every visitor.
   * Desktop only: on phones the button shows but is disabled. `?game` now only turns off music autoplay.
   */
  SHARD_FLIGHT_GAME: true,
  /**
   * Start shard flight by itself on desktop load. Off: visitors press the "Shard flight" button.
   * (Auto-start skipped past the button, so nobody saw it.)
   */
  SHARD_FLIGHT_AUTO_START: false,
  /** Dev: "Camera distance" readout top-left. Off for visitors; turn on when tuning the camera. */
  DEV_CAMERA_DISTANCE_HUD: false,
  /** Dev: treat the app as offline (music toast, Drive load errors). Toggle in GUI → Dev. */
  MOCK_OFFLINE: false,
};

/**
 * Check whether a flag is enabled.
 * @param {string} name
 * @returns {boolean}
 */
export function isEnabled(name) {
  return !!FLAGS[name];
}

/**
 * Set a flag value at runtime. Useful for testing or feature toggles.
 * @param {string} name
 * @param {boolean} value
 */
export function setFlag(name, value) {
  FLAGS[name] = !!value;
}

// expose raw object for introspection
export default FLAGS;
