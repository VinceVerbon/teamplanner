# Deploy to dexter - teamplanner.syquens.com

First real deploy done 2026-08-03 (F18). This doc records the host-specific facts
and the repeatable procedure. Generic stack docs: `deploy/README.md`.

## Host facts (observed 2026-08-03)

- Host: dexter.syquens.com. Public 443 open; **SSH is tailnet-only** (public 22
  closed) - connect via the Tailscale IP as `automation` with the dexter key
  (1P `SSH-sleutel dexter vverbon`, see `<MyAI>/docs/ssh-hosts-reference.md`).
- Traefik: provider network `traefik-proxy`, cert resolver `myresolver` (TLS
  challenge), entrypoints `web`/`websecure`, `crowdsec@docker` middleware global
  on the websecure entrypoint. Values consumed by `deploy/traefik.dexter.yaml`.
- Compose projects live under `/opt/docker/<name>`; this app: `/opt/docker/teamplanner`.
- DNS: `teamplanner.syquens.com` CNAME `dexter.syquens.com` (TTL 600), created via
  the GoDaddy API (1P item `Godaddy API Credential`, Kim en Vince).

## Procedure (initial deploy / redeploy)

```bash
# On dexter (as automation):
cd /opt/docker/teamplanner
git pull
cd deploy
docker compose -f compose.yaml -f traefik.dexter.yaml build
docker compose -f compose.yaml -f traefik.dexter.yaml up -d
docker exec tp-app wget -qO- http://127.0.0.1:3000/api/healthz
```

## Secrets

- `deploy/.env` on the host (mode 600), generated on-host at first deploy.
- Backed up in 1Password: item **`teamplanner dexter prod`** (Kim en Vince,
  id `akkdvym2cz5dpwci5eleevxtha`): Postgres password + `BETTER_AUTH_SECRET`.
- `SMTP_*` is **live since 2026-08-05**: the stack sends real mail via
  `smtp.gmail.com:587` (STARTTLS) as `teamplannernl@gmail.com`. Credentials in
  1Password item **`Gmail Teamplanner`** (Kim en Vince, id
  `mwd226o54rfmbq67r5so2nrytu`): `username`, `password` (account password),
  `app password smtp` (the SMTP credential -> `SMTP_PASS`), `totp secret` (the
  2FA authenticator seed) and `backup codes` (10 single-use Google recovery
  codes, space-separated, generated 2026-08-06). No phone number and no recovery
  email are registered, so those last two fields are the only ways back into the
  account - each backup code works once, and regenerating them in Google
  invalidates all ten.
- To rotate or re-apply: set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
  `SMTP_SECURE=false`, `SMTP_USER=<username>`, `SMTP_PASS=<app password smtp>`,
  `MAIL_FROM=teamplanner <username>` in `deploy/.env`, then
  `docker compose -f compose.yaml -f traefik.dexter.yaml up -d`. Previous file is
  kept as `.env.bak`.
- Gmail MVP limits apply: 500 recipients/day, ~20/hour, and Google rewrites the
  `From` header to the authenticated account. Switch to a domain sender
  (recommendation: SMTP2GO) per `docs/research-email-delivery.md` when volume or
  branding demands it.

### Verifying mail from the host

Outbound 587 from dexter is open (verified 2026-08-05). To re-test end-to-end,
run a one-off send inside the container - nodemailer only resolves from the
server output dir, and the hardened container cannot delete files afterwards, so
force-recreate `tp-app` when done:

```bash
docker cp send.mjs tp-app:/app/.output/server/send.mjs
docker exec -w /app/.output/server tp-app node send.mjs you@example.com
docker compose -f compose.yaml -f traefik.dexter.yaml up -d --force-recreate tp-app
```

## Security posture (reviewed 2026-08-03, sentinel-security)

Applied after the review: `cap_drop: ALL` + `no-new-privileges` + pids/memory limits
on both services, `tp-db` runs as `postgres`, and the dexter overlay adds a Traefik
rate-limit plus HSTS / nosniff / frameDeny / Referrer-Policy and strips
`X-Powered-By`. Router middlewares chain **after** the entrypoint's global
`crowdsec@docker`, so crowdsec stays in force. Verified on the live URL.

Confirmed good by the review: tp-db has no published port and is off `traefik-proxy`;
no privileged containers, no docker.sock, no host binds; one router, `websecure`
only; plain HTTP 404s (fails closed) rather than serving the app.

**Open items (tracked as F31 + below):**
- ~~First-run bootstrap is an unauthenticated takeover window on any fresh public
  deploy~~ **FIXED by F31 (built 2026-08-06)**: bootstrap routes now require
  `BOOTSTRAP_TOKEN` (404 when unset), the seed credential is `password: null`, and
  nothing advertises the state. Historical detail of the original window: on this
  deploy it was open ~10 minutes; the access log shows no POST to
  `/api/bootstrap/password` and no sign-in/sign-up from anyone but the operator IP,
  and the DB held exactly one user (the seeded admin) with zero sessions, so it was
  not exploited - but one unknown IP did fetch `/setup-admin` during the window.
  **This host completed first-run pre-F31** (admin password set 2026-08-03, in 1P
  `teamplanner dexter prod`), so dexter needs NO `BOOTSTRAP_TOKEN`: leaving it
  unset is the wanted end state (bootstrap surface answers 404). After the next
  image rebuild, optionally set `AUTH_DISABLE_SIGNUP=true` in `deploy/.env` for
  invite-only (decision open with Vince).
- No CSP yet (needs building against the Nuxt asset graph; start in report-only).
- Host-wide, outside this stack: the standalone `postgres` container binds
  `172.17.0.1:5432`, which is reachable from tp-app - an app RCE would get a
  network path to an unrelated database. Traefik's dashboard basicauth uses an
  apr1/MD5 hash. `/letsencrypt/access.log` has no rotation.
- No HTTP->HTTPS redirect (by design it 404s); if added, do it as a
  `redirectscheme` on the `web` entrypoint, never by binding a tp-app router to :80.

## First-run notes

- On a fresh database the app seeds `admin@teamplanner.local` with a **null**
  password (unusable for sign-in). Complete first-run per `deploy/README.md`:
  set `BOOTSTRAP_TOKEN`, open `/setup-admin?token=<value>`, set the password
  (1Password first), then remove the token from `.env` and recreate the app
  container (F22 + F31). This host already completed first-run on 2026-08-03.
- Backup surface: the `tp-pgdata` volume only. `docker exec tp-db pg_dump -U
  teamplanner -d teamplanner > backup.sql`.

## Gotchas hit at first deploy

- `/home/automation` was root-owned; docker buildx needs `~/.docker` - fixed with
  `sudo chown automation:automation /home/automation`.
- The app image builds on the host (no registry); `docker compose up` without a
  prior successful `build` tries to pull `teamplanner/app:local` from Docker Hub
  and fails with "access denied" - always build first.
