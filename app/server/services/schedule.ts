import { createError } from 'h3'
import { eq, and, gte, lte, isNull, or } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam } from '../utils/roles'
import { getCurrentClub } from './clubs'
import { locations, seasons, noTrainingPeriods, trainingSessions, teams } from '../db/schema'

async function requireClub() {
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'No club exists yet' })
  return club
}

async function requireAdmin(userId: string, clubId: string) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  return roles
}

// --- Locations (club-wide reusable register; admin manages, members read) ---

export async function listLocations() {
  const club = await requireClub()
  return getDb().select().from(locations)
    .where(eq(locations.clubId, club.id)).orderBy(locations.name)
}

export async function createLocation(requesterId: string, input: { name: string, address?: string }) {
  const club = await requireClub()
  await requireAdmin(requesterId, club.id)
  const name = input.name.trim()
  if (name.length < 2) throw createError({ statusCode: 400, statusMessage: 'Location name too short' })
  const [loc] = await getDb().insert(locations)
    .values({ clubId: club.id, name, address: input.address?.trim() || null }).returning()
  return loc!
}

export async function updateLocation(requesterId: string, locationId: string, patch: { name?: string, address?: string }) {
  const club = await requireClub()
  await requireAdmin(requesterId, club.id)
  const name = patch.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Location name too short' })
  }
  const [loc] = await getDb().update(locations)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(patch.address !== undefined ? { address: patch.address.trim() || null } : {})
    })
    .where(and(eq(locations.id, locationId), eq(locations.clubId, club.id)))
    .returning()
  if (!loc) throw createError({ statusCode: 404, statusMessage: 'Location not found' })
  return loc
}

export async function deleteLocation(requesterId: string, locationId: string) {
  const club = await requireClub()
  await requireAdmin(requesterId, club.id)
  try {
    const deleted = await getDb().delete(locations)
      .where(and(eq(locations.id, locationId), eq(locations.clubId, club.id))).returning()
    if (deleted.length === 0) throw createError({ statusCode: 404, statusMessage: 'Location not found' })
  } catch (e: unknown) {
    if ((e as { statusCode?: number }).statusCode === 404) throw e
    // FK violation: slots/sessions reference this location.
    throw createError({ statusCode: 409, statusMessage: 'Location is in use by trainings' })
  }
  return { removed: true }
}

// --- Seasons (admin manages) ---

export async function listSeasons() {
  const club = await requireClub()
  return getDb().select().from(seasons)
    .where(eq(seasons.clubId, club.id)).orderBy(seasons.startDate)
}

export async function createSeason(requesterId: string, input: { name: string, startDate: string, endDate: string }) {
  const club = await requireClub()
  await requireAdmin(requesterId, club.id)
  if (input.endDate < input.startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Season end date is before its start date' })
  }
  if (input.name.trim().length < 2) throw createError({ statusCode: 400, statusMessage: 'Season name too short' })
  const [season] = await getDb().insert(seasons)
    .values({ clubId: club.id, name: input.name.trim(), startDate: input.startDate, endDate: input.endDate })
    .returning()
  return season!
}

// --- No-training periods (two levels; adding one cancels overlapping sessions) ---

/** Club-level periods + (when teamId is given) that team's own periods. */
export async function listNoTrainingPeriods(teamId?: string) {
  const club = await requireClub()
  const db = getDb()
  const scope = teamId
    ? and(eq(noTrainingPeriods.clubId, club.id),
        or(isNull(noTrainingPeriods.teamId), eq(noTrainingPeriods.teamId, teamId)))
    : eq(noTrainingPeriods.clubId, club.id)
  return db.select().from(noTrainingPeriods).where(scope).orderBy(noTrainingPeriods.startDate)
}

/**
 * Create a no-training period.
 * - teamId null: club-level closure, admin only, cancels sessions of ALL teams in range.
 * - teamId set: team period, admin or active team staff, cancels that team's sessions.
 * Existing scheduled sessions inside the period are cancelled with the period's reason.
 */
export async function createNoTrainingPeriod(
  requesterId: string,
  input: { teamId?: string | null, startDate: string, endDate: string, reason: string }
) {
  const club = await requireClub()
  const db = getDb()
  const teamId = input.teamId || null
  // Authorization first, then input validation.
  if (teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
    if (!team || team.clubId !== club.id) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
    const roles = await getUserRoles(requesterId)
    if (!isClubAdmin(roles, club.id) && !isActiveStaffOfTeam(roles, teamId)) {
      throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
    }
  } else {
    await requireAdmin(requesterId, club.id)
  }
  if (input.endDate < input.startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Period end date is before its start date' })
  }
  const reason = input.reason.trim()
  if (reason.length < 2) throw createError({ statusCode: 400, statusMessage: 'A reason is required' })
  const [period] = await db.insert(noTrainingPeriods)
    .values({ clubId: club.id, teamId, startDate: input.startDate, endDate: input.endDate, reason })
    .returning()
  // Cancel overlapping scheduled sessions in scope.
  const scope = and(
    eq(trainingSessions.clubId, club.id),
    eq(trainingSessions.status, 'scheduled'),
    gte(trainingSessions.date, input.startDate),
    lte(trainingSessions.date, input.endDate),
    ...(teamId ? [eq(trainingSessions.teamId, teamId)] : [])
  )
  const cancelled = await db.update(trainingSessions)
    .set({ status: 'cancelled', cancelReason: reason })
    .where(scope)
    .returning()
  return { period: period!, cancelledSessions: cancelled.length }
}

/** Delete a period. Club-level: admin. Team-level: admin or that team's active staff. */
export async function deleteNoTrainingPeriod(requesterId: string, periodId: string) {
  const club = await requireClub()
  const db = getDb()
  const [period] = await db.select().from(noTrainingPeriods)
    .where(and(eq(noTrainingPeriods.id, periodId), eq(noTrainingPeriods.clubId, club.id)))
  if (!period) throw createError({ statusCode: 404, statusMessage: 'Period not found' })
  if (period.teamId) {
    const roles = await getUserRoles(requesterId)
    if (!isClubAdmin(roles, club.id) && !isActiveStaffOfTeam(roles, period.teamId)) {
      throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
    }
  } else {
    await requireAdmin(requesterId, club.id)
  }
  await db.delete(noTrainingPeriods).where(eq(noTrainingPeriods.id, periodId))
  // Cancelled sessions are NOT auto-reinstated: staff reinstate explicitly (the
  // reinstate path re-checks remaining periods, so club boundaries keep holding).
  return { removed: true }
}
