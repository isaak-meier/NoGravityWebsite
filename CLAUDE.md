# NoGravityWebsite (NXGRXVITY)

Three.js music-reactive 3D site (planet + orbiting pyramids/shards, audio from Google Drive)
plus a small Fastify API (magic-link auth, user state, mailing list, admin).
Live at nxgrxvity.com (static site on GitHub Pages; API on Fly.io).

> Note: `.github/copilot-instructions.md` is **stale** (describes an old single-file cube demo). Ignore it; trust this file and `docs/project-class-map.md`.

## Layout

- `index.html` — entry; loads `src/scene/three-scene.js` as the only app module. Deps via importmap/CDN (three, lil-gui, realtime-bpm-analyzer). **No build step.**
- `src/` — frontend ES modules (plain functions + state objects; subclassing is avoided — only `FFTStream extends EventTarget`). See `docs/project-class-map.md` for the full map.
  - `scene/` — `three-scene.js` (orchestrator), solar-system, comet, camera-controller, audio-manager, materials
  - `pyramid/` — orbiting pyramids, shard shatter, fragment patterns
  - `audio/` — FFT, beat detection, laser chunk analysis
  - `google/` — Drive audio + GIS auth · `auth/` — client auth UI · `state/` — server sync · `ui/` — knobs/dials/panels (factory fns) · `config/`, `math/`
- `server/` — separate npm workspace, Fastify 5 + better-sqlite3. `src/app.js` builds the instance; routes grouped by domain (`auth/ state/ mailing/ admin/`). Deployed to Fly.io (`fly.toml`, Docker).
- `docs/` — `project-class-map.md` (architecture), `superpowers/` (specs & plans), `notes/`.

## Commands

- `npm start` — static site at :3000
- `npm run setup:local` then `npm run dev:all` — site :3000 + API :8787 (SQLite, mail=noop logged to terminal, admin at /admin/)
- `npm test` (vitest, 27 frontend tests) · `npm test --prefix server` (7 server tests)

## Deploy

- Frontend: push to **`prod`** branch → GitHub Actions → Pages (`.github/workflows/deploy.yml`). It generates `build-info.js` and writes `app-config.local.json` from `GOOGLE_DRIVE_FOLDER_ID`/`GOOGLE_API_KEY` secrets.
- API: Fly.io (`server/DEPLOY.md`).

## Conventions (from `.cursor/rules/`)

- **Minimal scope** — change only what the task needs, no drive-by refactors. Extend existing helpers over parallel implementations.
- **~50-line function ceiling** — extract named helpers past one screen.
- Match nearby naming/imports/error-handling. Run the project's tests before claiming something works.
- Config (`app-config.local.json`, `server/.env`) is gitignored; examples are committed.
