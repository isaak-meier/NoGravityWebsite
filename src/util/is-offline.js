import { isEnabled, setFlag } from "../config/feature-flags.js";

/** @returns {boolean} true when the browser is offline or dev mock offline is on */
export function isOffline() {
  if (isEnabled("MOCK_OFFLINE")) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** @param {boolean} value */
export function setMockOffline(value) {
  setFlag("MOCK_OFFLINE", value);
}

/** @returns {boolean} */
export function getMockOffline() {
  return isEnabled("MOCK_OFFLINE");
}

function applyMockOfflineFromUrl() {
  if (typeof location === "undefined") return;
  const mockFromUrl = new URLSearchParams(location.search).get("mockOffline");
  if (mockFromUrl === "1" || mockFromUrl === "true") {
    setFlag("MOCK_OFFLINE", true);
  }
}

applyMockOfflineFromUrl();
