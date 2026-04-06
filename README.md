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

## Custom domain (nxgrxvity.com)

This repo includes a root [`CNAME`](CNAME) file so GitHub Pages serves the site at **https://nxgrxvity.com** after DNS and GitHub settings are configured.

### 1. DNS at your registrar

Point the **apex** domain to GitHub Pages using **four A records** (name/host `@` or blank, depending on the provider):

| Type | Name | Data |
|------|------|------|
| A | @ | `185.199.108.153` |
| A | @ | `185.199.109.153` |
| A | @ | `185.199.110.153` |
| A | @ | `185.199.111.153` |

Optional **www**: add a **CNAME** record: name `www`, target **`isaak-meier.github.io`** (replace with your GitHub username if different). Then in GitHub you can set redirects between apex and www.

IPv6 (optional): see [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain) for current `AAAA` records.

### 2. GitHub repository settings

1. Repo → **Settings** → **Pages** → **Custom domain**: enter **`nxgrxvity.com`** and save (should match `CNAME`).
2. Wait for DNS check to pass (can take minutes to hours).
3. Enable **Enforce HTTPS** once it becomes available.

### 3. Google Cloud (if you use Google Sign-In / Drive API)

Add **Authorized JavaScript origins** and **Authorized redirect URIs** for `https://nxgrxvity.com` (and `https://www.nxgrxvity.com` if you use www).

### Deploy branch

Production deploys from the **`prod`** branch (see `.github/workflows/deploy.yml`). Merge or fast-forward `prod` to match `main` after pushing changes.
