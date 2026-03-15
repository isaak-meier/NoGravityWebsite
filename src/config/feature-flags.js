// simple feature flag manager
// flags can be toggled at runtime via setFlag (useful for tests) or
// configured based on environment variables during build.

const FLAGS = {
  // enable GUI and upload in non-production builds
  // Default to true (dev mode) if process is undefined (browser env)
  ENABLE_GUI: typeof process === "undefined" || process.env.NODE_ENV !== "production",
  ENABLE_UPLOAD: typeof process === "undefined" || process.env.NODE_ENV !== "production",
  // future flags go here
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
