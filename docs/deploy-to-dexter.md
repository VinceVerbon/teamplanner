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
- `SMTP_*` is empty until the Gmail account exists (crosslog open issue) - mails
  are logged to the container console, not delivered. Fill `.env` + `docker compose
  ... up -d` to activate real mail.

## Security posture (reviewed 2026-08-03, sentinel-security)

Applied after the review: `cap_drop: ALL` + `no-new-privileges` + pids/memory limits
on both services, `tp-db` runs as `postgres`, and the dexter overlay adds a Traefik
rate-limit plus HSTS / nosniff / frameDeny / Referrer-Policy and strips
`X-Powered-By`. Router middlewares chain **after** the entrypoint's global
`crowdsec@docker`, so crowdsec stays in force. Verified on the live URL.

Confirmed good by the review: tp-db has no published port and is off `traefik-proxy`;
no privileged containers, no docker.sock, no host binds; one router, `websecure`
only; plain HTTP 404s (fails closed) rather than serving the app.

**Open items (tracked as F31 + below), not yet fixed:**
- First-run bootstrap is an unauthenticated takeover window on any fresh public
  deploy - see **F31**. On this deploy the window was open ~10 minutes; the access
  log shows no POST to `/api/bootstrap/password` and no sign-in/sign-up from anyone
  but the operator IP, and the DB holds exactly one user (the seeded admin) with
  zero sessions, so it was not exploited - but one unknown IP did fetch
  `/setup-admin` during the window. **Set the admin password immediately after any
  future fresh deploy, or deploy without the Traefik labels and do first-run over
  an SSH tunnel.**
- No CSP yet (needs building against the Nuxt asset graph; start in report-only).
- Host-wide, outside this stack: the standalone `postgres` container binds
  `172.17.0.1:5432`, which is reachable from tp-app - an app RCE would get a
  network path to an unrelated database. Traefik's dashboard basicauth uses an
  apr1/MD5 hash. `/letsencrypt/access.log` has no rotation.
- No HTTP->HTTPS redirect (by design it 404s); if added, do it as a
  `redirectscheme` on the `web` entrypoint, never by binding a tp-app router to :80.

## First-run notes

- On the fresh database the app seeds `admin@teamplanner.local` with an empty
  password; the first login forces setting a real one (F22). Do this right after
  deploy.
- Backup surface: the `tp-pgdata` volume only. `docker exec tp-db pg_dump -U
  teamplanner -d teamplanner > backup.sql`.

## Gotchas hit at first deploy

- `/home/automation` was root-owned; docker buildx needs `~/.docker` - fixed with
  `sudo chown automation:automation /home/automation`.
- The app image builds on the host (no registry); `docker compose up` without a
  prior successful `build` tries to pull `teamplanner/app:local` from Docker Hub
  and fails with "access denied" - always build first.
