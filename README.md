# NoGravityWebsite

NXGRXVIY website. Planet with shards, audio loading from google drive, some fun math.  
Live at nxgrxvity.com 

## Run locally (static site only)

- Install dependencies: `npm install`
- Start dev server: `npm start`
- Open: `http://localhost:3000`

## Full stack local testing (site + API)

Use this to exercise the mailing list (`POST /api/subscribe`), honeypot, magic-link auth, and admin UI against a local SQLite DB.

1. **Install both workspaces**

   ```bash
   npm install
   npm install --prefix server
   ```

2. **Create local config files** (gitignored — copied from examples only if missing)

   ```bash
   npm run setup:local
   ```

   This creates:

   - `src/config/app-config.local.json` — points `api.baseUrl` at `http://127.0.0.1:8787`
   - `server/.env` — dev defaults (`MAIL_TRANSPORT=noop`, mail logged to the API terminal; optional `INITIAL_ADMIN_EMAIL=` for admin)

3. **Run site + API together**

   ```bash
   npm run dev:all
   ```

   - Site: `http://localhost:3000`
   - API: `http://127.0.0.1:8787` — health check: `http://127.0.0.1:8787/healthz`
   - Admin UI: `http://127.0.0.1:8787/admin/`

4. **What to try**

   - Enter the planet interior → mailing panel → submit an email → API logs a “confirm” email body (noop mode); SQLite under `server/data/mail.db` if `DB_PATH` is set in `.env`.
   - Open the confirm link from the terminal output (token in URL) to flip subscriber to `confirmed`.
   - Sign-in pill (top right): request magic link; click link in terminal output → session cookie is set on the API origin (`localhost:8787`). Cross-origin cookie from port 3000 is limited in plain HTTP dev — see `server/DEPLOY.md`.

Or run **two terminals**: `npm start` (repo root) and `npm run dev:api`.
