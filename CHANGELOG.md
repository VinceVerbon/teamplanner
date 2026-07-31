# Changelog

All notable changes to teamplanner are documented here (Keep a Changelog; SemVer).

## [Unreleased]

### Added
- Initial scaffold (interactive-app) on 2026-07-31.
- App skeleton (`app/`): Nuxt 4 + Nitro with Nuxt UI v4, Pinia, VueUse, Zod; ESLint; Vitest test setup against in-memory PGlite.
- F1 (in progress): email/password registration with email verification and password reset via better-auth; dev mailer logs to console when no SMTP is configured; test-set covers signup, verification gate, verify-then-login, duplicate signup (no account overwrite), wrong password, short password, reset flow, and no-account-enumeration.
- F3 (in progress): sessions (login/logout), account page with profile (name edit, verified badge, date of birth) and role overview; `/api/me` endpoint; auth route middleware; test-set covers session retrieval, unauthenticated null, and sign-out revocation.
- F4 (in progress): Drizzle schema for club (tenant root), teams, club admins, staff assignments (pending/active per F8), single-team player registrations, parent links (pending/active per F5); role helper `getUserRoles` + guards; test-set covers no-roles, admin, player+multi-team staff on one identity, parent links, unique constraints, and pending-until-verified staff.
- Database layer: PGlite embedded (dev/tests) or PostgreSQL via `DATABASE_URL` (prod), Drizzle migrations applied at server startup.
- Pages: landing, register, login (with conditional Google button for F2), forgot/reset password, account (Dutch UI).
- `docs/FEATURES.md` - feature backlog F1-F19 logged ahead of build (identity and access, club and teams, trainings and schedule, attendance, communication, platform) plus architecture principles and stack decisions.

### Changed
- `docs/FEATURES.md` refined feature by feature with Vince: attendance flipped to an opt-out model with time-classified absence (F13, F14 dropped); parent-player linking with age-based management rules at P1 (F5); matches + Sportlink `.ical` import into MVP (F12, new F21); club branding/theming added (new F20); URL-per-club architecture; two-level no-training periods (F10); transparency of attendance stats to the whole team (F15, P1); Build spec added - every feature ships with a main-flow + edge-case test-set (Vitest/@nuxt/test-utils, Playwright later). First tenant FC Aalsmeer, first team MO17-4.
