// simple feature flag manager
// flags can be toggled at runtime via setFlag (useful for tests) or
// configured based on environment variables during build.

const FLAGS = {
  // Always on so production deploys match dev (no NODE_ENV gating).
  // Tests can still call setFlag to simulate disabled state.
  ENABLE_GUI: true,
  ENABLE_UPLOAD: true,
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
