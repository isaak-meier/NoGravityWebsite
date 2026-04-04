# NoGravityWebsite

NXGRXVIY website. Planet with shards, audio loading from google drive, some fun math. 

## Run locally

- Install dependencies: `npm install`
- Start dev server: `npm start`
- Open: `http://localhost:3000`

## Google Drive auto-load (optional)

`src/config/app-config.js` loads **`app-config.local.json`** next to it (defaults if missing). That file is **gitignored** — do not commit API keys.

**Local dev:** Copy `src/config/app-config.local.json.example` to `app-config.local.json` and set `folderId` and `apiKey`.

**GitHub Pages:** The [deploy workflow](.github/workflows/deploy.yml) generates `app-config.local.json` **during the deploy job** from secrets `GOOGLE_DRIVE_FOLDER_ID` and `GOOGLE_API_KEY` (repository or `github-pages` environment secrets). The deploy fails if either secret is missing. Restrict your Google API key to your site origin and the Drive API in Google Cloud Console.
