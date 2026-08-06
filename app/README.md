# teamplanner app

Nuxt 4 + Nitro full-stack app (Nuxt UI, Pinia, Zod, better-auth, Drizzle ORM).

## Dev

```bash
npm install
npm run dev
```

Opens on http://localhost:3000. Without `DATABASE_URL` the server runs on an embedded
PGlite database in `./.data/pglite`; migrations apply automatically at startup.
Without `SMTP_HOST` outgoing mail (verification, password reset) is logged to the console.

Copy `.env.example` to `.env` for local overrides. Full configuration reference
(every env var, plus the F31 first-run bootstrap ritual - a fresh database needs
`BOOTSTRAP_TOKEN` + `/setup-admin?token=...` before anyone can log in):
`../docs/configuration.md`.

## Tests

```bash
npm run test
```

Vitest against an in-memory PGlite instance. Every feature carries a test-set covering
the main flow and expected edge cases (see `../docs/FEATURES.md`, "Build spec").

## Database

- Schema: `server/db/schema.ts` (Drizzle)
- Migrations: `npm run db:generate` after schema changes (writes `server/db/migrations/`)
- Prod: set `DATABASE_URL` (PostgreSQL)
