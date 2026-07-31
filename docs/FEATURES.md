# teamplanner - Feature Log

Living product backlog. **Every feature gets an entry here BEFORE implementation starts.**

## How this file works

- New feature -> add an `F#` entry (next free number) with priority, status `planned`, and a short spec - before any code.
- Status flows: `planned` -> `in-progress` -> `shipped vX.Y.Z`. Shipping also adds the bullet to `CHANGELOG.md` `[Unreleased]` in the same commit.
- IDs are permanent and never reused. Dropped features get status `dropped` (with a one-line reason), not deletion.
- Priorities: **P1** = MVP (v0.1.0), **P2** = next, **P3** = later.

## Product vision

A club team-planning web app: members register themselves (email or social login), belong to a team, see their upcoming trainings and events, confirm attendance ahead of time, and staff take attendance and reach the team by automated email. One club with multiple teams to start; the architecture stays no-regret for opening it up as multi-tenant SaaS later.

## Architecture principles (no-regret for multi-tenant)

1. **Club = tenant root.** Every domain table carries `club_id` from day one and every query is scoped by it. v1 simply runs with a single club row.
2. **Identity is global, roles are assignments.** One account per person. A member is registered as **player with exactly one team**; the **same identity** may additionally hold **staff assignments on one or more teams**. Admin and parent are also per-club role assignments, not separate accounts.
3. **No cross-club data paths.** No query, view, or email may join across clubs.
4. **Secrets server-side only** via `useRuntimeConfig()` (never `public:`) - Flavour B golden rule.

## Stack decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| App | Nuxt 3 + Nitro + TypeScript, Nuxt UI, Pinia, VueUse, Zod | interactive-app Flavour B house stack (`<MyAI>/docs/interactive-app-scaffold.md` section 1B) |
| Auth | **better-auth** (MIT, FOSS) | In-app auth: email/password + verification + reset AND social OAuth in one library; organization plugin maps to club/teams and covers the multi-tenant future. WhereLog's Pocket-ID + oauth2-proxy pattern was considered and rejected: edge SSO with admin-managed users, no public self-registration or social signup. |
| Social providers | Google first; provider list config-driven | Extensible to Apple/Facebook/Microsoft without schema changes |
| Database | **PostgreSQL + Drizzle ORM** (FOSS) | Relational fits teams/attendance/RSVP; better-auth has a Drizzle adapter; Postgres scales to multi-tenant |
| Email | **Nodemailer over SMTP** | Provider/relay decided at first deploy; app code stays provider-agnostic |
| Deploy | Docker stack in `deploy/` (compose + multistage Dockerfile + Postgres) | WhereLog pattern; target host + domain TBD at first deploy |

## Feature backlog

### Identity & access

| ID | P | Status | Feature |
|----|---|--------|---------|
| F1 | P1 | planned | **Email/password registration** with email verification and password reset (better-auth). |
| F2 | P1 | planned | **Social login** - Google first; provider list config-driven, more providers = config not code. |
| F3 | P1 | planned | **Sessions, logout, account settings** - profile basics (name, email, avatar), session management. |
| F4 | P1 | planned | **Roles & permissions**: Admin / Staff (trainer-coach) / Player / Parent. Enforced server-side per route. Same identity can be player in one team AND staff on multiple teams. |
| F5 | P2 | planned | **Parent-guardian linking**: a parent account manages one or more child players (RSVP and attendance on their behalf). |

### Club & teams

| ID | P | Status | Feature |
|----|---|--------|---------|
| F6 | P1 | planned | **Club setup**: single club in v1, club record is the tenant root (name, branding basics, settings). |
| F7 | P1 | planned | **Team management**: create/edit/archive teams within the club. |
| F8 | P1 | planned | **Member administration**: player belongs to exactly one team; staff assignable to multiple teams; admin manages assignments. |
| F9 | P2 | planned | **Email invitations**: invite someone by email to register and land in the right team/role. |

### Trainings & schedule

| ID | P | Status | Feature |
|----|---|--------|---------|
| F10 | P1 | planned | **Training sessions**: one-off and recurring series, time and location, edit and cancel (cancellation visible to the team). |
| F11 | P1 | planned | **Upcoming schedule view**: per member, "my team's next trainings/events"; staff see all their teams. |
| F12 | P3 | planned | **Other event types**: matches, tournaments, social events - same schedule/RSVP machinery. |

### Attendance

| ID | P | Status | Feature |
|----|---|--------|---------|
| F13 | P1 | planned | **Attendance taking** by staff at/after a session: present / absent / excused per player. |
| F14 | P1 | planned | **RSVP ahead of a session** by player (or parent, once F5): coming / not coming / maybe; staff see the counts. |
| F15 | P2 | planned | **Attendance history and stats** per player and per team (rates, trends, exportable). |

### Communication

| ID | P | Status | Feature |
|----|---|--------|---------|
| F16 | P2 | planned | **Automated team email**: schedule reminders, change/cancellation notices, RSVP nudges; per-member opt-out. |
| F17 | P3 | planned | **Manual "email my team"** for staff/admin: compose once, delivered to the team respecting opt-outs. |

### Platform

| ID | P | Status | Feature |
|----|---|--------|---------|
| F18 | P2 | planned | **Production deploy stack**: `deploy/` compose + Dockerfile + Postgres per WhereLog pattern; `docs/deploy-to-<host>.md` written at first deploy. |
| F19 | P3 | planned | **Multi-tenant activation**: club self-signup and club-scoped admin onboarding - the payoff of the no-regret principles above. |
