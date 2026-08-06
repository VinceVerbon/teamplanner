# teamplanner deploy stack (F18)

Docker stack per the WhereLog pattern: one multistage-built Nuxt/Nitro app container
plus PostgreSQL 17. **Deployed on dexter as https://teamplanner.syquens.com since
2026-08-03** - host specifics and procedure: `docs/deploy-to-dexter.md`.

## Layout

- `compose.yaml` - `tp-app` (Nuxt 4 full-stack) + `tp-db` (Postgres 17, no host port).
- `app/Dockerfile` - multistage build; runtime ships `.output` + Drizzle migrations,
  runs as non-root uid 10001, healthchecks `/api/healthz`.
- `.env.example` - template for `deploy/.env` on the host (never committed).

## Run

From a repo clone on the host:

```bash
cd deploy
cp .env.example .env   # then fill values from 1Password
docker compose build
docker compose up -d
```

The app applies Drizzle migrations at startup and, when no bootstrap admin exists,
seeds the F22 admin (`admin@teamplanner.local`) with an UNUSABLE (null) password.
First-run setup (F31) is gated on a deploy-time secret:

1. Generate a long random `BOOTSTRAP_TOKEN`, set it in `deploy/.env`, `up -d`.
2. Open `https://<host>/setup-admin?token=<BOOTSTRAP_TOKEN>` and set the admin
   password (store it in 1Password FIRST, then submit).
3. Remove `BOOTSTRAP_TOKEN` from `.env` and recreate the app container - without
   the env var the bootstrap endpoints answer 404.

Optional: `AUTH_DISABLE_SIGNUP=true` makes the instance invite-only (F9
invitations / F23 admin-created accounts remain).

Full configuration reference (all env vars, F31 semantics, rate limits,
troubleshooting): `../docs/configuration.md`.

## Notes

- All app state lives in Postgres (logo uploads are DB columns): the `tp-pgdata`
  volume is the single backup surface. Backup:

```bash
docker exec tp-db pg_dump -U teamplanner -d teamplanner > teamplanner-$(date +%F).sql
```

- The DB is deliberately not published on a host port; it is only reachable from
  `tp-app` on the stack network.
- Behind Traefik (dexter/monkey): remove the `ports:` block on `tp-app`, join the
  external `proxy` network, and enable the commented routing labels in
  `compose.yaml`.
- Config validation for this stack lives in `app/tests/deploy.test.ts`.
