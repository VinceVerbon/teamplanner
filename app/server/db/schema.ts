import { pgTable, text, timestamp, boolean, date, uniqueIndex } from 'drizzle-orm/pg-core'

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
