# NoGravityWebsite

NXGRXVIY website. Planet with shards, audio loading from google drive, some fun math. 

## Run locally

- Install dependencies: `npm install`
- Start dev server: `npm start`
- Open: `http://localhost:3000`

## Google Drive auto-load (optional)

Do not commit API keys. Copy `src/config/app-config.local.json.example` to `src/config/app-config.local.json` (gitignored), then set `folderId` and optionally `apiKey`. The app merges that JSON over defaults in `src/config/app-config.js`.

