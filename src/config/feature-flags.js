// simple feature flag manager
// flags can be toggled at runtime via setFlag (useful for tests) or
// configured based on environment variables during build.

const FLAGS = {
  // Always on so production deploys match dev (no NODE_ENV gating).
  // Tests can still call setFlag to simulate disabled state.
  ENABLE_GUI: true,
  ENABLE_UPLOAD: true,
  /** Dev: first frame starts comet orbit follow (same controls as planet). Off = normal planet camera. */
  COMET_DEV_INSPECT_ON_LOAD: false,
  /** First Google Drive track loads and plays on load when a folder is configured. */
  AUTOPLAY_FIRST_DRIVE_TRACK_ON_LOAD: true,
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
