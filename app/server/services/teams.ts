import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin } from '../utils/roles'
import { teams } from '../db/schema'

async function requireAdmin(userId: string, clubId: string) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
}

export async function listTeams(clubId: string, opts: { includeArchived?: boolean } = {}) {
  const db = getDb()
  const where = opts.includeArchived
    ? eq(teams.clubId, clubId)
    : and(eq(teams.clubId, clubId), eq(teams.archived, false))
  return db.select().from(teams).where(where).orderBy(teams.name)
}

export async function createTeam(userId: string, clubId: string, name: string) {
  await requireAdmin(userId, clubId)
  const trimmed = name.trim()
  if (trimmed.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Team name too short' })
  }
  const db = getDb()
  const [team] = await db.insert(teams).values({ clubId, name: trimmed }).returning()
  return team!
}

export async function updateTeam(userId: string, teamId: string, patch: { name?: string, archived?: boolean }) {
  const db = getDb()
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  await requireAdmin(userId, team.clubId)
  const name = patch.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Team name too short' })
  }
  const [updated] = await db.update(teams)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {})
    })
    .where(eq(teams.id, teamId))
    .returning()
  return updated!
}
