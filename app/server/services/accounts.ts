import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { getDb } from '../utils/db'
import { auth } from '../utils/auth'
import { assertPasswordAllowed } from '../utils/password-policy'
import { getUserRoles, isClubAdmin } from '../utils/roles'
import { user, account, session, clubs } from '../db/schema'

export const BOOTSTRAP_ADMIN_EMAIL = 'admin@teamplanner.local'
const CREDENTIAL_PROVIDER = 'credential'

/**
 * F22: seed the default admin on a truly fresh install (zero users). The account starts
 * with an EMPTY password and mustSetPassword, so the only possible first action is
 * setting a real one via /api/bootstrap/password. Existing databases are never touched.
 */
export async function ensureBootstrapAdmin(): Promise<{ seeded: boolean }> {
  const db = getDb()
  const anyUser = await db.select({ id: user.id }).from(user).limit(1)
  if (anyUser.length > 0) return { seeded: false }
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
    password: await hashPassword('')
  })
  return { seeded: true }
}

async function findPendingBootstrapAdmin() {
  const db = getDb()
  const [admin] = await db.select().from(user)
    .where(and(eq(user.isBootstrapAdmin, true), eq(user.mustSetPassword, true)))
  return admin ?? null
}

/** F22: whether the first-run "set the admin password" step is still open. */
export async function bootstrapStatus(): Promise<{ pending: boolean, email: string | null }> {
  const admin = await findPendingBootstrapAdmin()
  return { pending: !!admin, email: admin ? admin.email : null }
}

/**
 * F22: one-shot first-run password set. Only works while the seeded admin still has its
 * empty bootstrap password; afterwards the path is gone (410) forever.
 */
export async function setBootstrapPassword(newPassword: string): Promise<{ email: string }> {
  const admin = await findPendingBootstrapAdmin()
  if (!admin) {
    throw createError({ statusCode: 410, statusMessage: 'First-run setup is already completed' })
  }
  const db = getDb()
  const [cred] = await db.select().from(account)
    .where(and(eq(account.userId, admin.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
  // Defense in depth: this path only ever replaces the seeded empty password.
  if (!cred?.password || !(await verifyPassword({ hash: cred.password, password: '' }))) {
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
 */
export async function createMemberAccount(requesterId: string, input: CreateAccountInput) {
  const db = getDb()
  const [club] = await db.select({ id: clubs.id }).from(clubs).limit(1)
  if (!club) {
    throw createError({ statusCode: 409, statusMessage: 'Create the club first' })
  }
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, club.id)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
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
