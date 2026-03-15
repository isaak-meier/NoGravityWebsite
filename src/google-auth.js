// Google Drive OAuth2 authentication and Picker integration

const DEFAULT_CLIENT_ID =
  "809499910600-5p16dejrbq0hrqqdgb3ssk75clebqmuo.apps.googleusercontent.com";
const CLIENT_ID =
  (typeof window !== "undefined" && window.__GOOGLE_CLIENT_ID__) ||
  DEFAULT_CLIENT_ID;
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const GOOGLE_API_SCRIPT_ID = "google-api-js";
const GOOGLE_API_SCRIPT_SRC = "https://apis.google.com/js/api.js";

let tokenClient = null;
let accessToken = null;
let pickerReadyPromise = null;

function loadScriptOnce(id, src) {
  const existing = document.getElementById(id);
  if (existing) {
    return new Promise((resolve, reject) => {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureGooglePickerLoaded() {
  if (window.google && window.google.picker && window.google.picker.PickerBuilder) {
    return;
  }

  if (!pickerReadyPromise) {
    pickerReadyPromise = (async () => {
      if (!window.gapi) {
        await loadScriptOnce(GOOGLE_API_SCRIPT_ID, GOOGLE_API_SCRIPT_SRC);
      }

      await new Promise((resolve, reject) => {
        if (!window.gapi || !window.gapi.load) {
          reject(new Error("Google API client failed to initialize"));
          return;
        }

        window.gapi.load("picker", {
          callback: resolve,
          onerror: () => reject(new Error("Failed to load Google Picker API")),
          timeout: 7000,
          ontimeout: () => reject(new Error("Timed out loading Google Picker API")),
        });
      });

      if (!(window.google && window.google.picker && window.google.picker.PickerBuilder)) {
        throw new Error("Google Picker API not loaded");
      }
    })().catch((err) => {
      pickerReadyPromise = null;
      throw err;
    });
  }

  return pickerReadyPromise;
}

function buildSetupHint() {
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "http://localhost:3000";
  return [
    "Google OAuth blocked this request.",
    "In Google Cloud Console, verify:",
    `1) OAuth client type is Web application and Authorized JavaScript origins contains ${origin}`,
    "2) OAuth consent screen is configured",
    "3) If Publishing status is Testing, your Google account is added under Test users",
  ].join("\n");
}

function toOAuthError(response) {
  if (!response) {
    return new Error(`Google auth failed with no response.\n\n${buildSetupHint()}`);
  }

  if (response.error === "popup_closed") {
    return new Error("Google sign-in popup was closed before completing login.");
  }

  if (response.error === "access_denied") {
    return new Error(`Error 403: access_denied\n\n${buildSetupHint()}`);
  }

  const details = response.error_description || response.details || "Unknown OAuth error";
  return new Error(`Google auth failed: ${response.error || "error"} (${details})`);
}

/**
 * Initialize the Google Identity Services library.
 * Call this once when the page loads.
 */
export function initializeGoogleAuth() {
  if (!window.google || !window.google.accounts) {
    console.warn("Google Identity Services not loaded yet");
    return;
  }

  if (!CLIENT_ID || CLIENT_ID.includes("Replace")) {
    console.error("Missing Google OAuth Client ID");
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES.join(" "),
    callback: () => {},
    error_callback: () => {},
  });
}

/**
 * Request Google Sign-In and return the access token.
 * Prompts the user to log in if not already signed in.
 */
export async function requestGoogleAuth() {
  if (!tokenClient) {
    console.error("Google auth not initialized");
    return null;
  }

  return new Promise((resolve, reject) => {
    if (accessToken) {
      resolve(accessToken);
      return;
    }

    tokenClient.callback = (response) => {
      if (response && response.error) {
        reject(toOAuthError(response));
        return;
      }

      if (!response || !response.access_token) {
        reject(toOAuthError(response));
        return;
      }

      accessToken = response.access_token;
      console.log("Google auth successful, access token obtained");
      resolve(accessToken);
    };

    tokenClient.error_callback = (response) => {
      reject(toOAuthError(response));
    };

    tokenClient.requestAccessToken({
      prompt: "consent",
      scope: SCOPES.join(" "),
    });
  });
}

/**
 * Use Google Picker API to let the user select a folder from Drive.
 * Returns the selected folder info { id, name }, or null if cancelled.
 */
export async function showGoogleDrivePicker() {
  await ensureGooglePickerLoaded();

  return new Promise((resolve) => {
    if (!accessToken) {
      resolve(null);
      return;
    }

    const picker = new window.google.picker.PickerBuilder()
      .addView(
        new window.google.picker.DocsView(
          window.google.picker.ViewId.FOLDERS
        ).setSelectFolderEnabled(true)
      )
      .setOAuthToken(accessToken)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const folder = data.docs[0] || {};
          const folderInfo = {
            id: folder.id,
            name: folder.name || folder.title || "Unnamed folder",
          };
          console.log("Selected folder:", folderInfo);
          resolve(folderInfo);
        } else if (
          data.action === window.google.picker.Action.CANCEL ||
          data.action === window.google.picker.Action.LOADED
        ) {
          resolve(null);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

/**
 * Get the current access token (if signed in).
 */
export function getAccessToken() {
  return accessToken;
}

/**
 * Sign out from Google.
 */
export function signOutGoogle() {
  if (window.google && window.google.accounts) {
    window.google.accounts.id.disableAutoSelect();
  }
  accessToken = null;
}
