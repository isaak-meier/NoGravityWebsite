const DEFAULT_DURATION_MS = 4200;

/** @type {HTMLElement | null} */
let host = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let hideTimer = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "cockpit-toast-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

/**
 * Brief HUD toast matching cockpit dial chrome.
 * @param {string} message
 * @param {{ durationMs?: number }} [opts]
 */
export function showCockpitToast(message, { durationMs = DEFAULT_DURATION_MS } = {}) {
  if (typeof document === "undefined" || !message) return;

  const root = ensureHost();
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  root.replaceChildren();

  const toast = document.createElement("div");
  toast.className = "cockpit-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  root.appendChild(toast);

  hideTimer = setTimeout(() => {
    root.replaceChildren();
    hideTimer = null;
  }, durationMs);
}

/** @internal — reset between tests */
export function _resetCockpitToastForTests() {
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
}
