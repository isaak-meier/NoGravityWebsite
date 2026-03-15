const APP_CONFIG = {
  googleDrive: {
    // Paste your Google Drive folder ID here (the long string from the folder URL).
    // Example URL: https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
    // Folder ID:                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // When set, the app auto-loads audio files from this folder on startup.
    folderId: "1kR5Lim6cINqalNNl6vf2H6DSg7w8tNH6",

    // Google API key (from Cloud Console → APIs & Services → Credentials).
    // Required only for public folders (shared as "Anyone with the link").
    // If using OAuth sign-in (private folders), this can stay null.
    apiKey: "AIzaSyBlyJjhMAlu0ALur7PQ_IZV7LzBCPfPAsE",
  },
};

export default APP_CONFIG;
