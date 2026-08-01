import { pgTable, text, timestamp, boolean, date, integer, uniqueIndex } from 'drizzle-orm/pg-core'

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

// --- domain tables (club = tenant root; every domain table carries club_id) ---

export const clubs = pgTable('clubs', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const teams = pgTable('teams', {
  id: id(),
  clubId: text('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  archived: boolean('archived').notNull().default(false),
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
