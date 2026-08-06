import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { getDb } from '../utils/db'
import { auth } from '../utils/auth'
import { assertPasswordAllowed } from '../utils/password-policy'
import { getUserRoles, isClubAdmin, isInstanceAdmin } from '../utils/roles'
import { user, account, session, clubs, instanceAdmins } from '../db/schema'

export const BOOTSTRAP_ADMIN_EMAIL = 'admin@teamplanner.local'
const CREDENTIAL_PROVIDER = 'credential'

/**
 * F22/F31: seed the default admin when no bootstrap admin exists yet. The credential
 * row is seeded with password NULL, so normal sign-in can never authenticate it; the
 * only way in is /api/bootstrap/password, which is gated on BOOTSTRAP_TOKEN (F31).
 * Idempotent on the isBootstrapAdmin flag (not "zero users"): a stranger's signup on
 * a fresh public deploy can no longer suppress seeding, and an instance that lost its
 * admin gets a deploy-operator recovery path.
 */
export async function ensureBootstrapAdmin(): Promise<{ seeded: boolean }> {
  const db = getDb()
  const existing = await db.select({ id: user.id }).from(user)
    .where(eq(user.isBootstrapAdmin, true)).limit(1)
  if (existing.length > 0) return { seeded: false }
  const [admin] = await db.insert(user).values({
    name: 'Beheerder',
    email: BOOTSTRAP_ADMIN_EMAIL,
    emailVerified: true,
    mustSetPassword: true,
    isBootstrapAdmin: true
  }).returning()
  await db.insert(account).values({
    accountId: admin!.id,
    providerId: CREDENTIAL_PROVIDER,
    userId: admin!.id,
    password: null
  })
  // F26: the seeded account is the first INSTANCE admin (not implicitly a club admin).
  await db.insert(instanceAdmins).values({ userId: admin!.id })
  return { seeded: true }
}

/**
 * F26 backfill: databases seeded before the instance-admin split have a bootstrap admin
 * but zero instance_admins rows - a state that locks instance management entirely.
 * Promote the bootstrap admin once; no-op whenever any instance admin exists.
 */
export async function ensureInstanceAdminBackfill(): Promise<{ backfilled: boolean }> {
  const db = getDb()
  const existing = await db.select({ id: instanceAdmins.id }).from(instanceAdmins).limit(1)
  if (existing.length > 0) return { backfilled: false }
  const [bootstrap] = await db.select({ id: user.id }).from(user)
    .where(eq(user.isBootstrapAdmin, true))
  if (!bootstrap) return { backfilled: false }
  await db.insert(instanceAdmins).values({ userId: bootstrap.id })
  return { backfilled: true }
}

async function findPendingBootstrapAdmin() {
  const db = getDb()
  const [admin] = await db.select().from(user)
    .where(and(eq(user.isBootstrapAdmin, true), eq(user.mustSetPassword, true)))
  return admin ?? null
}

/** F22/F31: whether the first-run "set the admin password" step is still open.
 * Boolean only - the email is not exposed (the route sits behind BOOTSTRAP_TOKEN). */
export async function bootstrapStatus(): Promise<{ pending: boolean }> {
  const admin = await findPendingBootstrapAdmin()
  return { pending: !!admin }
}

/**
 * F22/F31: one-shot first-run password set. Only works while the seeded admin still has
 * its unusable bootstrap credential (password NULL, or the legacy scrypt('') from
 * pre-F31 seeds); afterwards the path is gone (410) forever.
 */
export async function setBootstrapPassword(newPassword: string): Promise<{ email: string }> {
  const admin = await findPendingBootstrapAdmin()
  if (!admin) {
    throw createError({ statusCode: 410, statusMessage: 'First-run setup is already completed' })
  }
  const db = getDb()
  const [cred] = await db.select().from(account)
    .where(and(eq(account.userId, admin.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
  // Defense in depth: this path only ever replaces the seeded unusable credential.
  if (!cred || !(cred.password === null
    || await verifyPassword({ hash: cred.password, password: '' }))) {
    throw createError({ statusCode: 410, statusMessage: 'First-run setup is already completed' })
  }
  await assertPasswordAllowed(newPassword)
  await db.update(account)
    .set({ password: await hashPassword(newPassword) })
    .where(eq(account.id, cred.id))
  await db.update(user).set({ mustSetPassword: false }).where(eq(user.id, admin.id))
  // Any session obtained via the empty bootstrap password dies with it.
  await db.delete(session).where(eq(session.userId, admin.id))
  return { email: admin.email }
}

export interface CreateAccountInput {
  name: string
  email: string
  password: string
  dateOfBirth?: string | null
  mustChangePassword?: boolean
}

/**
 * F23: admin creates an account directly - no self-registration, no email verification
 * required (the admin vouches for the address; emailVerified is set so sign-in works
 * immediately). Optionally forces a password change on first login.
 * F26: identity is instance-level, so instance admins may always do this; club admins
 * may too (they onboard their members).
 */
export async function createMemberAccount(requesterId: string, input: CreateAccountInput) {
  const db = getDb()
  const roles = await getUserRoles(requesterId)
  if (!isInstanceAdmin(roles)) {
    const [club] = await db.select({ id: clubs.id }).from(clubs).limit(1)
    if (!club || !isClubAdmin(roles, club.id)) {
      throw createError({ statusCode: 403, statusMessage: 'Instance admin or club admin role required' })
    }
  }
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  if (name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Name too short' })
  }
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
  }
  await assertPasswordAllowed(input.password)
  const [created] = await db.insert(user).values({
    name,
    email,
    emailVerified: true,
    dateOfBirth: input.dateOfBirth ?? null,
    mustSetPassword: input.mustChangePassword ?? true
  }).returning()
  await db.insert(account).values({
    accountId: created!.id,
    providerId: CREDENTIAL_PROVIDER,
    userId: created!.id,
    password: await hashPassword(input.password)
  })
  return {
    id: created!.id,
    name: created!.name,
    email: created!.email,
    mustSetPassword: created!.mustSetPassword
  }
}

/**
 * Canonical own-password change (used by the forced first-login flow and voluntarily).
 * Delegates verification + update to better-auth (policy enforced by the auth hook),
 * then clears the mustSetPassword gate.
 */
export async function changeOwnPassword(headers: Headers, currentPassword: string, newPassword: string) {
  // Resolve the user BEFORE changing: revokeOtherSessions can invalidate the very
  // session these headers carry (bearer tokens), after which getSession returns null.
  const session = await auth.api.getSession({ headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  await auth.api.changePassword({
    body: { currentPassword, newPassword, revokeOtherSessions: true },
    headers
  })
  await getDb().update(user).set({ mustSetPassword: false }).where(eq(user.id, session.user.id))
  return { changed: true }
}
