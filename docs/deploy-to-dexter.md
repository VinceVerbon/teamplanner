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
