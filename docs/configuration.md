# Configuration reference

All teamplanner configuration is **environment variables** - there are no config
files. In dev the app reads `app/.env` (copy of `app/.env.example`); in the deploy
stack the `tp-app` container reads `deploy/.env` via compose `env_file` (copy of
`deploy/.env.example`, values from 1Password). Secrets never live in tracked files:
reference 1Password items in comments, never values.

Quick index (every variable the server reads):

| Variable | Required | Default when unset | Purpose |
|----------|----------|--------------------|---------|
| `DATABASE_URL` | prod | embedded PGlite in `./.data/pglite` | PostgreSQL connection string |
| `TEAMPLANNER_DATA_DIR` | no | `./.data/pglite` | PGlite data dir; `memory` = in-memory (tests) |
| `TEAMPLANNER_MIGRATIONS_DIR` | no | resolved relative to the server bundle | Drizzle migrations folder override (set by the Docker image) |
| `BETTER_AUTH_SECRET` | **prod** | insecure dev-only constant | better-auth signing secret |
| `BETTER_AUTH_URL` | **prod** | `http://localhost:3000` | public base URL; also used in mailed links |
| `BOOTSTRAP_TOKEN` | first-run only | **unset = bootstrap surface answers 404** | F31 gate for first-run admin setup (see below) |
| `AUTH_DISABLE_SIGNUP` | no | `false` (signup open) | `true` = invite-only instance (see below) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google button hidden | F2 Google OAuth |
| `SMTP_HOST` | no | mail logged to console | SMTP relay host; setting it makes mail REAL |
| `SMTP_PORT` | no | `587` | SMTP port |
| `SMTP_SECURE` | no | `false` (STARTTLS) | `true` = implicit TLS (465) |
| `SMTP_USER` / `SMTP_PASS` | with SMTP_HOST | - | SMTP credentials (app password, 1P `Gmail Teamplanner`) |
| `MAIL_FROM` | no | `SMTP_USER` | From header (Gmail rewrites it to the account) |
| `MAIL_DISPATCH_DISABLED` | no | dispatcher on | `true` = F16 interval mailer off (also auto-off when `TEAMPLANNER_DATA_DIR=memory`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | deploy | user/db default `teamplanner`; password required | deploy-only: `tp-db` credentials; compose assembles `DATABASE_URL` from them |
| `TP_HTTP_PORT` | deploy | `3000` | deploy-only: published host port (dropped behind Traefik) |

The deploy stack's env contract is additionally guarded by `app/tests/deploy.test.ts`
(compose interpolations and prod-relevant app vars must appear in
`deploy/.env.example`, dev-only vars must not).

---

## First-run bootstrap (F22 + F31)

How a fresh installation gets its first administrator - and why it is locked down
the way it is.

### Security model

The original F22 design ("possession of the app is the credential": seeded admin
with an empty password, public `/setup-admin`, status endpoint advertised on the
login page) was rated **CRITICAL** by the 2026-08-03 security review of the live
dexter deploy: on any fresh public deploy, the first caller to reach the port
became instance admin, and certificate-transparency scanners found the host within
~60 seconds of cert issuance. F31 (built 2026-08-06) replaces that model:
**possession of the deploy environment is the credential.** Only someone who can
set an environment variable on the host - by definition the operator - can
complete first-run setup.

Three independent layers enforce this:

1. **Token gate** - the bootstrap endpoints require `BOOTSTRAP_TOKEN`; without the
   env var they answer 404 for everyone.
2. **Unusable seed credential** - the seeded admin's password column is SQL `NULL`,
   which better-auth can never match; there is no password that signs in to the
   bootstrap account before setup completes.
3. **No advertising** - nothing in the app reveals that a first run is pending:
   no login-page alert, no public status oracle, no email in any response.

### `BOOTSTRAP_TOKEN` semantics

- Checked by `server/utils/bootstrap-token.ts` on both bootstrap routes.
- Supplied per request as header `x-bootstrap-token` or query `?token=...`
  (the `/setup-admin` page forwards its `?token=` query as the header).
- Compared **timing-safe**: both values are sha256-hashed first, then compared
  with `crypto.timingSafeEqual`, so neither the length nor any prefix of the
  configured token leaks through response timing.
- There is deliberately **no in-code fallback token and no auto-generation**: a
  route that "helpfully" invents a token would reopen the takeover window.

Behavior matrix for `GET /api/bootstrap/status` and `POST /api/bootstrap/password`:

| `BOOTSTRAP_TOKEN` env | Request token | Result |
|-----------------------|---------------|--------|
| unset (or empty) | anything | **404** - the routes do not exist; a completed install keeps no reachable bootstrap surface |
| set | missing or wrong | **401** Invalid bootstrap token |
| set | correct | proceed: status returns `{ pending: boolean }` (nothing else); password set returns `{ email }` once, then **410** forever |
| set | correct, but too many attempts | **429** (rate limit, below) |

### The first-run ritual

Fresh install (prod):

1. Generate a long random token (32+ chars, e.g. `openssl rand -base64 32`), set
   `BOOTSTRAP_TOKEN=<value>` in `deploy/.env`, start the stack (`up -d`).
2. The startup log confirms the seed:
   `Seeded default admin admin@teamplanner.local (no usable password yet)` and
   points at the setup URL. If the token is missing it warns instead - see
   Recovery below.
3. Open `https://<host>/setup-admin?token=<value>`. The page checks the pending
   state through the token and shows the password form (policy-checked, F24).
4. **Store the chosen admin password in 1Password FIRST**, then submit. The
   server sets the password, clears `mustSetPassword`, kills any sessions on the
   account, and the page signs you in.
5. **Remove `BOOTSTRAP_TOKEN` from `.env`** (or set it empty) and recreate the
   app container. End state: the bootstrap surface answers 404. Keeping the token
   set after setup is harmless for takeover (the 410 hard-gate is DB-state-based)
   but leaves a needless authenticated probe surface - remove it.

Dev: same flow with training wheels - put e.g. `BOOTSTRAP_TOKEN=dev-setup` in
`app/.env` and visit `http://localhost:3000/setup-admin?token=dev-setup` after
the first start on a fresh database. Note that a fresh dev database is NOT
signable-in before this step (the seed password is null, not empty - pre-F31
muscle memory of "log in with the empty password" no longer works).

### Seeding rules (`ensureBootstrapAdmin`, runs at every startup)

- Seeds `admin@teamplanner.local` when **no user with `isBootstrapAdmin: true`
  exists** - not "when zero users exist" (pre-F31). Consequences:
  - A stranger registering on a fresh public deploy can no longer suppress
    seeding forever (the old behavior had no recovery path in code).
  - An instance that somehow lost its bootstrap admin gets one re-seeded -
    unusable until the operator sets `BOOTSTRAP_TOKEN` and completes setup.
    This is the sanctioned **operator recovery path** for an admin-less
    instance; it is safe on existing databases precisely because the seed
    credential is null and the routes are token-gated.
- The seed is: `emailVerified: true`, `mustSetPassword: true`,
  `isBootstrapAdmin: true`, credential `password: null`, plus an
  `instance_admins` row (F26: instance admin, NOT implicitly club admin).
- It never seeds twice: one bootstrap admin exists at most, completed or not.

### Legacy databases (seeded before F31)

Pre-F31 seeds stored `scrypt('')` - a real hash of the empty string - so
`password: ''` could sign in during the bootstrap window. `setBootstrapPassword`
accepts **exactly two** credential states as "still the seed": `NULL` (F31) or a
hash that verifies against the empty string (legacy). Anything else - i.e. a real
password - is refused with 410, so this path can never be used to overwrite a
configured admin password, even if `mustSetPassword` is somehow still set (e.g. a
crash between the password update and the flag clear). A legacy install that
upgrades mid-bootstrap therefore completes its first run normally (token now
required); a completed install is untouched.

### Rate limits (F31, `server/utils/rate-limit.ts`)

In-memory fixed-window counters, per app process (the deploy runs a single
instance; Traefik adds a coarser proxy-level limit in front):

| Endpoint | Key | Limit |
|----------|-----|-------|
| `POST /api/bootstrap/password` | client IP (`x-forwarded-for` aware) | 5 / 15 min |
| `GET /api/bootstrap/status` | client IP | 30 / 15 min (higher: the setup page probes it; separate key so probing cannot starve the password budget) |
| `POST /api/me/password` | authenticated user id | 5 / 15 min |

`/api/me/password` is limited here because it calls the server-side
`auth.api.changePassword()`, which **bypasses better-auth's own router-level
limiter** - without this cap an authenticated user could brute-force their
current-password check. Limits reset on app restart (accepted: restarts are
operator actions).

### Recovery and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Startup log warns `BOOTSTRAP_TOKEN is not set - first-run setup is disabled` | fresh DB seeded, no token configured | set `BOOTSTRAP_TOKEN`, restart, do the ritual. Nothing is lost - the seed waits |
| `/setup-admin` says the page only works via the installation link | opened without `?token=` | use the full URL with the token |
| 401 on setup despite the right-looking token | token mismatch (quoting/whitespace in `.env`) | re-set the env var, recreate the container; the value is compared byte-exact |
| 410 on `/api/bootstrap/password` | first run already completed | log in normally; admin password is in 1Password (`teamplanner dexter prod` for dexter) |
| 429 during setup | rate limit hit | wait 15 min (or restart the app - the counters are in-memory) |
| Instance has users but no admin | pre-F31 suppressed seed, or admin deleted | restart on F31+: a bootstrap admin is re-seeded; set the token and complete setup |

### Existing deploy: dexter

`teamplanner.syquens.com` completed its first run pre-F31 (2026-08-03, password
in 1P `teamplanner dexter prod`). It must **keep `BOOTSTRAP_TOKEN` unset** - that
is the wanted end state, the bootstrap surface answers 404 there as soon as the
F31 image is deployed. Details: `docs/deploy-to-dexter.md`.

---

## Registration switch: `AUTH_DISABLE_SIGNUP`

- `AUTH_DISABLE_SIGNUP=true` disables better-auth's public email/password signup:
  the instance becomes **invite-only**. Accounts then enter via F9 email
  invitations (which register through the invitation accept flow) or F23
  admin-created accounts.
- Default (unset or anything but `true`): signup stays open - F1 self-registration
  with email verification works unchanged.
- Read once at startup; changing it requires an app restart.
- Current stance: dev and dexter run with signup **open**; closing prod is an
  open product decision (tracked in the F31 FEATURES row).

## Auth core

- `BETTER_AUTH_SECRET` - signs sessions/tokens. REQUIRED in prod (the dev
  fallback is a publicly known constant). Generate long random; store in 1P
  (`teamplanner dexter prod` holds dexter's).
- `BETTER_AUTH_URL` - the public origin users reach the app on. Also the base
  for every mailed link (verification, reset, invitations, parent-link
  confirmations), so a wrong value breaks mail flows silently.

## Database

- `DATABASE_URL` set: real PostgreSQL (prod; the deploy compose assembles it
  from `POSTGRES_*` so the parts live in one place).
- Unset: embedded PGlite under `./.data/pglite` (dev) or the dir in
  `TEAMPLANNER_DATA_DIR`; `TEAMPLANNER_DATA_DIR=memory` gives the in-memory
  instance the tests use.
- Drizzle migrations apply automatically at startup (`server/plugins/migrate.ts`,
  which also runs the F22/F31 seed and the F26 instance-admin backfill).
  `TEAMPLANNER_MIGRATIONS_DIR` overrides where they are read from - the Docker
  image sets it to the path the migrations are shipped at; leave it alone
  otherwise.

## Mail (SMTP)

- `SMTP_HOST` unset: every outgoing mail is logged to the console instead of
  sent - the safe dev default. Setting it flips ALL mail (F1 verification/reset,
  F5 parent links, F9 invitations, F16 team mails) to real delivery: in dev,
  only set it deliberately.
- Production sends via Gmail MVP (`smtp.gmail.com:587`, STARTTLS, app password;
  1P item `Gmail Teamplanner`) - limits and the domain-sender exit strategy in
  `docs/research-email-delivery.md`.
- `MAIL_DISPATCH_DISABLED=true` switches off the F16 interval dispatcher (15 min
  tick) without touching event-driven notices; it is also auto-disabled when
  `TEAMPLANNER_DATA_DIR=memory` (tests drive dispatch directly).

## Google OAuth (F2)

Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set: the Google login button
appears and better-auth's Google provider activates. Either missing: the button
is hidden and the provider is off. No other behavior changes.
