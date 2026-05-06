# No Gravity API server

Node.js (Fastify) + SQLite backend for nxgrxvity.com. Provides magic-link auth,
per-user state persistence, mailing list signup with double opt-in, and a tiny
admin UI for sending campaigns.

## Run locally

```
cd server
npm install
cp .env.example .env   # then edit values you care about
npm run dev
```

By default the dev server:

- listens on `http://127.0.0.1:8787`
- stores SQLite in `:memory:` (set `DB_PATH=./data/mail.db` to persist)
- uses the **noop** mail transport (emails are logged to stdout, never sent).
  Set `MAIL_TRANSPORT=resend` plus `RESEND_API_KEY` to send real email.

`GET /healthz` should return `{"ok":true}`.

## Tests

```
npm test         # watch mode
npm run test:run # one-shot
```

## Layout

```
server/
  src/
    app.js     Fastify builder (used by entry + tests)
    index.js   Entry point: build app, listen on PORT
    config.js  Env -> frozen config
    db.js      SQLite open + migration runner
    mail.js    MailSender abstraction (Resend + Noop)
  migrations/
    001_init.sql
  test/
    helpers.js     buildTestApp() with in-memory DB + noop mailer
    smoke.test.js  /healthz + migrations + mailer captures sends
  public/admin/    (added in Phase 6)
```
