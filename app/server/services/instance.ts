import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isInstanceAdmin } from '../utils/roles'
import { instanceAdmins, instanceSettings, user } from '../db/schema'

// F26: instance-level management - the deployment is not the club. Settings here are
// system-wide (formats, week numbering); club settings live on the club record.

async function requireInstanceAdmin(userId: string) {
  const roles = await getUserRoles(userId)
  if (!isInstanceAdmin(roles)) {
    throw createError({ statusCode: 403, statusMessage: 'Instance admin role required' })
  }
}

export type InstanceSettings = typeof instanceSettings.$inferSelect

/** The single settings row, lazily created with defaults on first read. */
export async function getInstanceSettings(): Promise<InstanceSettings> {
  const db = getDb()
  const [row] = await db.select().from(instanceSettings).limit(1)
  if (row) return row
  const [created] = await db.insert(instanceSettings).values({}).returning()
  return created!
}

export interface InstanceSettingsPatch {
  dateFormat?: 'DD-MM-YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  timeFormat?: '24h' | '12h'
  weekNumbering?: 'iso' | 'us'
}

export async function updateInstanceSettings(requesterId: string, patch: InstanceSettingsPatch) {
  await requireInstanceAdmin(requesterId)
  const current = await getInstanceSettings()
  const db = getDb()
  const [updated] = await db.update(instanceSettings)
    .set({
      ...(patch.dateFormat !== undefined ? { dateFormat: patch.dateFormat } : {}),
      ...(patch.timeFormat !== undefined ? { timeFormat: patch.timeFormat } : {}),
      ...(patch.weekNumbering !== undefined ? { weekNumbering: patch.weekNumbering } : {})
    })
    .where(eq(instanceSettings.id, current.id))
    .returning()
  return updated!
}

export async function listInstanceAdmins(requesterId: string) {
  await requireInstanceAdmin(requesterId)
  return getDb().select({
    id: instanceAdmins.id, userId: user.id, name: user.name, email: user.email
  }).from(instanceAdmins)
    .innerJoin(user, eq(instanceAdmins.userId, user.id))
    .orderBy(user.name)
}

/** Grant instance admin to a registered identity by exact email. */
export async function grantInstanceAdmin(requesterId: string, email: string) {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const [target] = await db.select({ id: user.id }).from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No registered account with this email' })
  const existing = await db.select({ id: instanceAdmins.id }).from(instanceAdmins)
    .where(eq(instanceAdmins.userId, target.id))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already an instance admin' })
  }
  const [row] = await db.insert(instanceAdmins).values({ userId: target.id }).returning()
  return row!
}

/** Revoke an instance admin; the last one can never be removed. */
export async function revokeInstanceAdmin(requesterId: string, assignmentId: string) {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const [row] = await db.select().from(instanceAdmins).where(eq(instanceAdmins.id, assignmentId))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Instance admin assignment not found' })
  const all = await db.select({ id: instanceAdmins.id }).from(instanceAdmins)
  if (all.length <= 1) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove the last instance admin' })
  }
  await db.delete(instanceAdmins).where(eq(instanceAdmins.id, assignmentId))
  return { removed: true }
}
