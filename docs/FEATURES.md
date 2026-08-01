# teamplanner - Feature Log

Living product backlog. **Every feature gets an entry here BEFORE implementation starts.**

## How this file works

- New feature -> add an `F#` entry (next free number) with priority, status `planned`, and a short spec - before any code.
- Status flows: `planned` -> `in-progress` -> `shipped vX.Y.Z`. Shipping also adds the bullet to `CHANGELOG.md` `[Unreleased]` in the same commit.
- IDs are permanent and never reused. Dropped features get status `dropped` (with a one-line reason), not deletion.
- Priorities: **P1** = MVP (v0.1.0), **P2** = next, **P3** = later.

## Product vision

A club team-planning web app: members register themselves (email or Google), belong to a team, see their upcoming trainings and matches, and are **expected to attend** - absence requires actively notifying, and attendance behaviour is **transparent to everyone concerned with the team** (players, staff, parents). Staff plan trainings, import matches from Sportlink, and reach the team by automated email.

First tenant: **FC Aalsmeer**, starting with one team: **MO17-4**. One club with multiple teams to start; the architecture stays no-regret for opening up as multi-tenant SaaS later.

## Architecture principles (no-regret for multi-tenant)

1. **Club = tenant root, also in the URL.** Every domain table carries `club_id` from day one and every query is scoped by it. Routing is designed as `teamplanner.com/<club>/...` with `<club>.teamplanner.com` as alternate form; while single-club this defaults invisibly to the one club (FC Aalsmeer). v1 runs with a single club row.
2. **Identity is global, roles are assignments.** One account per person. A member is registered as **player with exactly one team**; the **same identity** may additionally hold **staff assignments on one or more teams (including the team where they play)**, and/or be **parent of one or more players**. Admin is also a per-club role assignment, not a separate account.
3. **Attendance is opt-out, and visible.** The default is presence; absence is actively reported and time-classified. Attendance data is transparent to all players, staff, and parents of the team - by design, to drive attendance and make selection decisions unsurprising.
4. **No cross-club data paths.** No query, view, or email may join across clubs.
5. **Secrets server-side only** via `useRuntimeConfig()` (never `public:`) - Flavour B golden rule.

## Build spec

**Every feature and change is built with testing in mind.** Every feature ships with a test-set that actively tests the **main flow AND the most expected edge cases** - written alongside the implementation, not after. A feature is not `shipped` until its test-set passes. Server-side logic (permissions, age rules, absence classification, club scoping) is the priority surface: those rules live in testable functions, not inlined in route handlers.

## Stack decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| App | Nuxt 4 + Nitro + TypeScript, Nuxt UI v4, Pinia, VueUse, Zod | interactive-app Flavour B house stack (`<MyAI>/docs/interactive-app-scaffold.md` section 1B; doc says Nuxt 3 - current stable at init was Nuxt 4.5) |
| Auth | **better-auth** (MIT, FOSS) | In-app auth: email/password + verification + reset AND social OAuth in one library; organization plugin maps to club/teams and covers the multi-tenant future. WhereLog's Pocket-ID + oauth2-proxy pattern was considered and rejected: edge SSO with admin-managed users, no public self-registration or social signup. |
| Social providers | Google first; provider list config-driven | Extensible to Apple/Facebook/Microsoft without schema changes |
| Database | **PostgreSQL + Drizzle ORM** (FOSS) | Relational fits teams/attendance/absence records; better-auth has a Drizzle adapter; Postgres scales to multi-tenant |
| Email | **Nodemailer over SMTP** | Provider/relay decided at first deploy; app code stays provider-agnostic |
| Testing | **Vitest + @nuxt/test-utils** (unit/integration), **Playwright** for e2e when UI flows stabilize | FOSS; Vitest is the Nuxt-native runner; every feature ships with a main-flow + edge-case test-set (see Build spec) |
| Deploy | Docker stack in `deploy/` (compose + multistage Dockerfile + Postgres) | WhereLog pattern; target host + domain TBD at first deploy |

## Feature backlog

### Identity & access

| ID | P | Status | Feature |
|----|---|--------|---------|
| F1 | P1 | in-progress | **Email/password registration** with email verification and password reset (better-auth). |
| F2 | P1 | planned | **Social login**: sign up / log in with Google or email. Provider list config-driven; more providers = config not code. |
| F3 | P1 | in-progress | **Sessions, logout, account settings** - profile basics (name, email, avatar, **date of birth** - required for players, drives the F5 age rules), session management. |
| F4 | P1 | in-progress | **Roles & permissions**: Admin / Staff (trainer-coach) / Player / Parent, enforced server-side per route. One identity can be player in exactly one team AND staff on one or more teams (including their own player team), and/or parent of one or more players. |
| F5 | P1 | in-progress | **Parent-player linking with age-based attendance management.** Linking works in BOTH directions: a player enters their parent's email, or a parent enters their player's email; the other party receives a verification email and must acknowledge before the link is active. Age rules for attendance self-management: **15+** enabled; **under 15** disabled by default but can be enabled per account (checkmark). **Parents can always manage attendance until the player turns 18.** At 18+ the parent link stays active but parent management defaults off; the player gets the setting **"mijn ouder mag mijn aanwezigheid beheren"** to re-enable it. |

### Club & teams

| ID | P | Status | Feature |
|----|---|--------|---------|
| F6 | P1 | in-progress | **Club setup**: single club record in v1 (FC Aalsmeer) as tenant root AND URL root (see architecture principle 1) - name, settings; defaulted invisibly while single-club. |
| F7 | P1 | in-progress | **Team management**: create/edit/archive teams within the club. First team: MO17-4. |
| F8 | P1 | in-progress | **Member administration**: player belongs to exactly one team; staff assignable to multiple teams (incl. their own player team). Existing team staff can add new staff members; those assignments are **verified by admin**, or an admin sets the staff role on the team directly once the identity is registered. Admin always retains manage/enforce. |
| F9 | P2 | planned | **Email invitations**: invite someone by email to register and land in the right team/role; includes team staff inviting/setting other team staff per the F8 verification flow. |
| F20 | P1 | planned | **Club branding & theming**: upload club logo; theme colors derived from the logo as default; configurable via theme management. |

### Trainings & schedule

| ID | P | Status | Feature |
|----|---|--------|---------|
| F10 | P1 | in-progress | **Training sessions**: weekly default schedule (fixed slots generating sessions), reusable **locations register**, **trainer per session**, **season bounds** (series run within a season), plus one-off sessions, edit and cancel (visible to team). **No-training periods at two levels**: admin/club-level closures governing all teams, and team-level periods for the team's own schedule - a team can never supersede admin boundaries. |
| F11 | P1 | in-progress | **Upcoming schedule view**: per member "my team's next trainings/matches"; staff see all their teams. **Planned absences are visible in this view.** |
| F12 | P1 | planned | **Matches** as event type on the same schedule/absence machinery - needed in MVP (they feed the automated pre-match mails, F16). Tournaments and social events follow later (P3, same machinery). |
| F21 | P1 | planned | **Sportlink match import**: parse a Sportlink `.ical` (or similar) file containing all matches, locations and times; **preview before load**, then import into the schedule. |

### Attendance

| ID | P | Status | Feature |
|----|---|--------|---------|
| F13 | P1 | planned | **Absence notification & attendance tracking (opt-out model)**: attendance is expected; players (or parents, per F5 rules) actively report absence. Reported **>= 1.5 h before start** = timely absence; **between 1.5 h and start** = late absence; **not reported before start** = no-show/overdue notification. All of it transparently visible to all players, staff, and parents in the team. Staff can correct/confirm actuals after the session. |
| F14 | - | dropped | ~~RSVP coming/not coming/maybe~~ - superseded by the F13 opt-out model: attendance is expected, absence requires actively notifying. |
| F15 | P1 | planned | **Attendance transparency & stats**: every player's training attendance percentage visible to **everyone concerned with the team** - all players, staff, and parents of all players - on the roster view. Deliberate design: transparency drives attendance and makes playing-time decisions unsurprising. History, trends and export follow in P2. |

### Communication

| ID | P | Status | Feature |
|----|---|--------|---------|
| F16 | P2 | planned | **Automated team email**: schedule reminders, change/cancellation notices, absence nudges, and **automated pre-match mails** with match info (from F12/F21); per-member opt-out. |
| F17 | P3 | planned | **Manual "email my team"** for staff/admin: compose once, delivered to the team respecting opt-outs. |

### Platform

| ID | P | Status | Feature |
|----|---|--------|---------|
| F18 | P2 | planned | **Production deploy stack**: `deploy/` compose + Dockerfile + Postgres per WhereLog pattern; `docs/deploy-to-<host>.md` written at first deploy. |
| F19 | P3 | planned | **Multi-tenant activation**: club self-signup and club-scoped admin onboarding via the URL-per-club routing (F6) - the payoff of the no-regret principles above. |
