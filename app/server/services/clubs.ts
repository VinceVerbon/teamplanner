import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin } from '../utils/roles'
import { clubs, clubAdmins } from '../db/schema'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** v1: single club. The first authenticated user to create it becomes its admin (bootstrap). */
export async function createClub(userId: string, input: { slug: string, name: string }) {
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid club slug (lowercase letters, digits, hyphens)' })
  }
  if (name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Club name too short' })
  }
  const db = getDb()
  const existing = await db.select({ id: clubs.id }).from(clubs).limit(1)
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'A club already exists (single-club mode)' })
  }
  const [club] = await db.insert(clubs).values({ slug, name }).returning()
  await db.insert(clubAdmins).values({ clubId: club!.id, userId })
  return club!
}

/** The single club of this deployment, or null before bootstrap. */
export async function getCurrentClub() {
  const db = getDb()
  const rows = await db.select().from(clubs).limit(1)
  return rows[0] ?? null
}

export async function updateClub(userId: string, clubId: string, patch: { name?: string }) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const name = patch.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Club name too short' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({ ...(name !== undefined ? { name } : {}) })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return club
}
