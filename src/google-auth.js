// Google Drive OAuth2 authentication and Picker integration

// YOU MUST SET THESE VALUES:
// Get your Client ID from Google Cloud Console (https://console.cloud.google.com/)
const CLIENT_ID = "809499910600-5p16dejrbq0hrqqdgb3ssk75clebqmuo.apps.googleusercontent.com"; // Replace with your OAuth 2.0 Client ID
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

let tokenClient = null;
let accessToken = null;

/**
 * Initialize the Google Identity Services library.
 * Call this once when the page loads.
 */
export function initializeGoogleAuth() {
  if (!window.google || !window.google.accounts) {
    console.warn("Google Identity Services not loaded yet");
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES.join(" "),
    callback: (response) => {
      if (response.error !== undefined) {
        throw response;
      }
      accessToken = response.access_token;
      console.log("Google auth successful, access token obtained");
    },
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
  return new Promise((resolve) => {
    // If we already have a token, use it
    if (accessToken) {
      resolve(accessToken);
      return;
    }
    // Otherwise request a new token
    tokenClient.requestAccessToken();
    // Wait a bit for the callback to fire
    setTimeout(() => {
      resolve(accessToken);
    }, 500);
  });
}

/**
 * Use Google Picker API to let the user select a folder from Drive.
 * Returns the selected folder ID, or null if cancelled.
 */
export function showGoogleDrivePicker() {
  return new Promise((resolve) => {
    if (!window.google || !window.google.picker) {
      console.error("Google Picker API not loaded");
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
          const folderId = data.docs[0].id;
          console.log("Selected folder ID:", folderId);
          resolve(folderId);
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
