import { pgTable, text, timestamp, boolean, date, integer, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())

// --- better-auth core tables (standard shapes for the drizzle adapter) ---

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // Drives the F5 age rules; required for players (enforced at player registration, not at signup)
  dateOfBirth: date('date_of_birth'),
  // F5 under-15 checkmark: allows a young player to manage their own attendance (set by parent/admin).
  selfManageOptIn: boolean('self_manage_opt_in').notNull().default(false),
  // F5 18+ setting "mijn ouder mag mijn aanwezigheid beheren" (owned by the player).
  parentManageOptIn: boolean('parent_manage_opt_in').notNull().default(false),
  // F22/F23: account may not use the app until a (new) password is set - enforced in
  // requireUser, cleared by the set/change-password flows.
  mustSetPassword: boolean('must_set_password').notNull().default(false),
  // F22: the seeded first-run admin; admin of the (single) club without a club_admins row.
  isBootstrapAdmin: boolean('is_bootstrap_admin').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const session = pgTable('session', {
  id: id(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const account = pgTable('account', {
  id: id(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const verification = pgTable('verification', {
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

// --- instance level (F26): the deployment is not the club - one instance can hold
// multiple clubs later. Instance admins manage instance concerns (settings, clubs,
// instance admins); club admins manage their club only.

export const instanceAdmins = pgTable('instance_admins', {
  id: id(),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// Single-row settings table (lazily created with defaults on first read).
export const instanceSettings = pgTable('instance_settings', {
  id: id(),
  dateFormat: text('date_format', { enum: ['DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] }).notNull().default('DD-MM-YYYY'),
  timeFormat: text('time_format', { enum: ['24h', '12h'] }).notNull().default('24h'),
  weekNumbering: text('week_numbering', { enum: ['iso', 'us'] }).notNull().default('iso'),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// --- domain tables (club = tenant root; every domain table carries club_id) ---

export const clubs = pgTable('clubs', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // F20 branding: logo stored inline (base64, capped at upload), theme primary color
  // derived from the logo client-side as default and configurable by the admin.
  logoData: text('logo_data'),
  logoMime: text('logo_mime'),
  primaryColor: text('primary_color'),
  // F24: enforced password strength standard; 'medium' is the default, lowering it is
  // an explicit admin decision (confirmed in the UI before it activates). 'custom' uses
  // the passwordCustom* rule columns below.
  passwordPolicy: text('password_policy', { enum: ['low', 'medium', 'strong', 'custom'] }).notNull().default('medium'),
  passwordCustomMinLength: integer('password_custom_min_length').notNull().default(8),
  passwordCustomRequireLowercase: boolean('password_custom_require_lowercase').notNull().default(false),
  passwordCustomRequireUppercase: boolean('password_custom_require_uppercase').notNull().default(false),
  passwordCustomRequireDigit: boolean('password_custom_require_digit').notNull().default(false),
  passwordCustomRequireSymbol: boolean('password_custom_require_symbol').notNull().default(false),
  // F25: navigation bar placement for the Beheer shell - a theme setting.
  navPlacement: text('nav_placement', { enum: ['left', 'top', 'right'] }).notNull().default('left'),
  // F27: exactly one main location (the club's own address/main site); by definition
  // a club location. Forward reference: locations is declared below.
  mainLocationId: text('main_location_id').references((): AnyPgColumn => locations.id, { onDelete: 'set null' }),
  // F28: a club always plays in a KNVB region; the flag additionally offers the
  // nationale kalender as an option at team level.
  region: text('region', { enum: ['noord', 'oost', 'west', 'zuid'] }),
  hasNationalTeams: boolean('has_national_teams').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const teams = pgTable('teams', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  archived: boolean('archived').notNull().default(false),
  // F28: the team's speeldagenkalender category = a column of the kalender selected by
  // club region (or the nationale kalender when the club flags national teams).
  kalenderColumnId: text('kalender_column_id').references((): AnyPgColumn => speeldagKalenderColumns.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const clubAdmins = pgTable('club_admins', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [uniqueIndex('club_admins_club_user_uq').on(t.clubId, t.userId)])

// Staff added by existing team staff start as 'pending' until an admin verifies (F8);
// admins can create them as 'active' directly.
export const staffAssignments = pgTable('staff_assignments', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'active'] }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [uniqueIndex('staff_assignments_team_user_uq').on(t.teamId, t.userId)])

// A player is registered with exactly one team: user_id is unique across the table.
export const playerRegistrations = pgTable('player_registrations', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// --- F10 trainings ---

// Season bounds: training series (slots) generate sessions within a season.
export const seasons = pgTable('seasons', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// Reusable club-wide locations register.
export const locations = pgTable('locations', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  // F27: marked club locations (own grounds/sites); the main one is clubs.mainLocationId.
  isClubLocation: boolean('is_club_location').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// Weekly default schedule: a fixed slot generates sessions for the season.
// weekday is ISO: 1 = Monday .. 7 = Sunday. Times are 'HH:MM'.
export const trainingSlots = pgTable('training_slots', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  seasonId: text('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  locationId: text('location_id').notNull().references(() => locations.id),
  trainerUserId: text('trainer_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// Materialized sessions/events: trainings generated from a slot (slotId set) or
// one-off (slotId null), and matches (F12) as event type on the SAME machinery so
// F13 absences attach uniformly. Cancelled sessions stay visible to the team.
// Trainings carry a register locationId; imported matches may carry a free-text
// location instead (away grounds don't belong in the club register).
export const trainingSessions = pgTable('training_sessions', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['training', 'match'] }).notNull().default('training'),
  slotId: text('slot_id').references(() => trainingSlots.id, { onDelete: 'set null' }),
  date: date('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  locationId: text('location_id').references(() => locations.id),
  locationText: text('location_text'),
  trainerUserId: text('trainer_user_id').references(() => user.id, { onDelete: 'set null' }),
  // match fields (F12/F21)
  opponent: text('opponent'),
  homeAway: text('home_away', { enum: ['home', 'away'] }),
  externalUid: text('external_uid'),
  status: text('status', { enum: ['scheduled', 'cancelled'] }).notNull().default('scheduled'),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [uniqueIndex('training_sessions_team_external_uid_uq').on(t.teamId, t.externalUid)])

// No-training periods at two levels: teamId null = club-level closure (governs ALL
// teams, set by admin); teamId set = the team's own period. A team period can never
// supersede a club closure (enforced in the services, not here).
export const noTrainingPeriods = pgTable('no_training_periods', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

// F13: absences on the opt-out model. Attendance is expected; an absence row is the
// active notification. classification is computed AT REPORT TIME against session start:
// >= 1.5h before = timely, between 1.5h and start = late, at/after start (incl. staff
// corrections afterwards) = no-show. source 'staff' = staff-recorded actual (F13
// "correct/confirm actuals"). Transparent to the whole team by design (F15).
export const absences = pgTable('absences', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => trainingSessions.id, { onDelete: 'cascade' }),
  playerUserId: text('player_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  reportedByUserId: text('reported_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  classification: text('classification', { enum: ['timely', 'late', 'no-show'] }).notNull(),
  source: text('source', { enum: ['reported', 'staff'] }).notNull().default('reported'),
  reason: text('reason'),
  reportedAt: timestamp('reported_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [uniqueIndex('absences_session_player_uq').on(t.sessionId, t.playerUserId)])

// --- F28: KNVB speeldagenkalenders - INSTANCE level (fetched/parsed centrally, no
// club_id). One kalender per (season, region, status); columns are the categories the
// PDF carries horizontally; days are the speeldag rows; cells hold the matrix values.
// Lifecycle: 'pending' after fetch -> 'active' after the admin activates/processes.

export const speeldagKalenders = pgTable('speeldag_kalenders', {
  id: id(),
  season: text('season').notNull(),
  region: text('region', { enum: ['landelijk', 'landelijk-jeugd', 'noord', 'oost', 'west', 'zuid'] }).notNull(),
  status: text('status', { enum: ['pending', 'active'] }).notNull().default('pending'),
  title: text('title').notNull(),
  sourceUrl: text('source_url').notNull(),
  fetchedAt: timestamp('fetched_at').notNull().defaultNow()
}, t => [uniqueIndex('speeldag_kalenders_season_region_status_uq').on(t.season, t.region, t.status)])

export const speeldagKalenderColumns = pgTable('speeldag_kalender_columns', {
  id: id(),
  kalenderId: text('kalender_id').notNull().references(() => speeldagKalenders.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull()
})

export const speeldagKalenderDays = pgTable('speeldag_kalender_days', {
  id: id(),
  kalenderId: text('kalender_id').notNull().references(() => speeldagKalenders.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  label: text('label').notNull(),
  dateStart: date('date_start').notNull(),
  dateEnd: date('date_end'),
  remark: text('remark')
})

export const speeldagKalenderCells = pgTable('speeldag_kalender_cells', {
  id: id(),
  kalenderId: text('kalender_id').notNull().references(() => speeldagKalenders.id, { onDelete: 'cascade' }),
  dayId: text('day_id').notNull().references(() => speeldagKalenderDays.id, { onDelete: 'cascade' }),
  columnId: text('column_id').notNull().references(() => speeldagKalenderColumns.id, { onDelete: 'cascade' }),
  value: text('value').notNull()
}, t => [uniqueIndex('speeldag_cells_day_column_uq').on(t.dayId, t.columnId)])

// Central changelog of PROCESSED kalender changes - visible to all clubs and staff.
// No FK to the kalender: entries survive replacements and force reloads.
export const speeldagKalenderChanges = pgTable('speeldag_kalender_changes', {
  id: id(),
  batchId: text('batch_id').notNull(),
  season: text('season').notNull(),
  region: text('region').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  changedAt: timestamp('changed_at').notNull().defaultNow()
})

// Link becomes 'active' only after the other party confirms by email (F5).
// Works in both directions: requestedBy records which side initiated; the OTHER side
// receives the token by mail and must confirm.
export const parentLinks = pgTable('parent_links', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  parentUserId: text('parent_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  playerUserId: text('player_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  requestedBy: text('requested_by', { enum: ['parent', 'player'] }).notNull(),
  token: text('token').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  status: text('status', { enum: ['pending', 'active'] }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, t => [uniqueIndex('parent_links_parent_player_uq').on(t.parentUserId, t.playerUserId)])

// F9: email invitations - invite an UNREGISTERED email to register and land in the
// right team/role. staffStatus snapshots the F8 semantics at invite time: invited by
// an admin -> the assignment becomes 'active' on accept; invited by team staff ->
// 'pending' until an admin verifies. Player invites are admin-only (mirrors F8).
// 'expired' is derived from expiresAt, not stored. One pending invite per (team, email),
// enforced in the service.
export const invitations = pgTable('invitations', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', { enum: ['player', 'staff'] }).notNull(),
  staffStatus: text('staff_status', { enum: ['pending', 'active'] }),
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  token: text('token').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  status: text('status', { enum: ['pending', 'accepted', 'cancelled'] }).notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedByUserId: text('accepted_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow()
})
