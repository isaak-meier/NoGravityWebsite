# Deploying the No Gravity API

The static site continues to deploy via the existing `main` -> `prod` ->
GitHub Pages flow (see `.cursor/skills/deploy-prod-from-main/SKILL.md`). The
API is a separate deploy onto Fly.io with its own DNS subdomain.

## One-time setup (do these in order)

### 1. Resend (transactional email)

1. Create a Resend account: <https://resend.com>.
2. Add the domain `nxgrxvity.com` in Resend. It will give you SPF + DKIM + DMARC
   DNS records. Add them at your DNS host (the same place you set the apex
   `nxgrxvity.com` records). Wait for Resend to verify (usually minutes).
3. Generate an API key in Resend (`re_...`). Save it for step 4.

### 2. Fly.io app + volume

```sh
cd server
fly launch --no-deploy --copy-config --name no-gravity-api --region iad
fly volumes create data --region iad --size 1
```

Confirm `fly.toml`'s `app =` matches whatever name `fly launch` accepted.

### 3. Secrets

```sh
fly secrets set \
  RESEND_API_KEY=re_xxx \
  SESSION_SECRET=$(openssl rand -hex 32) \
  INITIAL_ADMIN_EMAIL=you@nxgrxvity.com
```

`SESSION_SECRET` is mostly reserved for future HMAC use; setting it now means
you don't have to redeploy when we start using it.

### 4. First deploy

```sh
fly deploy
```

Watch the build, then verify:

```sh
curl https://no-gravity-api.fly.dev/healthz
# -> {"ok":true}
```

### 5. DNS — point `api.nxgrxvity.com` at Fly

```sh
fly ips list   # shows the v4 + v6 IPs Fly assigned
```

At your DNS host add:

- `api.nxgrxvity.com  A     <fly v4 ip>`
- `api.nxgrxvity.com  AAAA  <fly v6 ip>`

Then issue the cert:

```sh
fly certs add api.nxgrxvity.com
fly certs check api.nxgrxvity.com   # repeat until "verified"
```

### 6. Flip the static site to use the API

In production, the site reads `appConfig.api.baseUrl`. Once `api.nxgrxvity.com`
is healthy, set it. Two options:

- **Recommended (production default):** edit `src/config/app-config.js` to set
  `defaults.api.baseUrl = "https://api.nxgrxvity.com"`. Commit, deploy via the
  usual `main` -> `prod` flow.
- **Per-deploy override:** ship `app-config.local.json` alongside the static
  site with `{ "api": { "baseUrl": "https://api.nxgrxvity.com" } }`.

## Smoke test (post-deploy)

```sh
# 1. Mailing list signup -> confirm
curl -s -X POST https://api.nxgrxvity.com/api/subscribe \
  -H "content-type: application/json" \
  -H "origin: https://nxgrxvity.com" \
  --data '{"email":"you+test@nxgrxvity.com"}'
# Open the confirm link from the email -> "You're in" page.

# 2. Magic-link login (admin)
curl -s -X POST https://api.nxgrxvity.com/api/auth/request-link \
  -H "content-type: application/json" \
  -H "origin: https://nxgrxvity.com" \
  --data '{"email":"you@nxgrxvity.com","next":"https://nxgrxvity.com"}'
# Click the link -> redirected to nxgrxvity.com with session cookie set.
# Visit https://api.nxgrxvity.com/admin/ -> sign in via magic link -> dashboard.

# 3. Per-user state round-trip (do this in a browser via the site)
# After signing in, the auth pill in the top-right shows your email.
# `GET /api/me/state` returns {} initially. PUT something, then sign in from
# another browser/device -> state syncs back via the same magic-link flow.

# 4. Send a campaign to yourself
# In /admin -> Campaigns -> New draft -> Subject + body -> "Send test to me".
# When happy, "Send to all" (with confirm).
```

## Local dev cookie note

Because the site (`http://localhost:3000`) and the API
(`http://localhost:8787`) are different origins in dev, browsers won't send
the session cookie cross-origin without `SameSite=None; Secure`, which
requires HTTPS. We use `SameSite=Lax` in dev, which means:

- The magic-link click works (top-level navigation to API origin sets the
  cookie). You'll be logged in **on the API origin**.
- Cross-origin fetches from `localhost:3000` won't carry the cookie. So the
  in-page sign-in flow on the static site is best tested in production,
  against `api.nxgrxvity.com`.

For full local dev with credentialed cross-origin fetches, run mkcert HTTPS on
both ports, or have Fastify serve the static site on the API origin.

## Routine deploys

After the one-time setup, redeploys are just:

```sh
cd server
fly deploy
```

Migrations run automatically on boot (any new `migrations/NNN_*.sql` files
that aren't in `schema_migrations` are applied inside a transaction).
