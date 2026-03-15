# NoGravityWebsite

Minimal static Three.js site with optional audio-reactive visuals and Google Drive audio loading.

## Run locally

- Install dependencies: `npm install`
- Start dev server: `npm start`
- Open: `http://localhost:3000`

## Customer-facing auto-load from Google Drive

To auto-load the first song from a preselected Google Drive folder at page load, update `src/app-config.js`:

```js
const APP_CONFIG = {
	googleDrive: {
		folderId: "YOUR_FOLDER_ID",
		apiKey: "YOUR_PUBLIC_API_KEY",
	},
};
```

Notes:

- Audio files are listed with `name_natural` ordering and the first file is auto-loaded.
- Browser autoplay policies may require a user click before audio starts, but the file is still loaded and ready.
- For customer-facing usage, your folder/files must be accessible for the configured API key scenario.
