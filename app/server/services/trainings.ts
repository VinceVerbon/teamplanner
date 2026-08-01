import { createError } from 'h3'
import { eq, and, gte, or, isNull, asc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam, type UserRoles } from '../utils/roles'
import { slotSessionDates, inAnyRange, type DateRange } from '../utils/schedule-dates'
import {
  teams, seasons, locations, trainingSlots, trainingSessions, staffAssignments,
  playerRegistrations, noTrainingPeriods, user
} from '../db/schema'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function getTeamOr404(teamId: string) {
  const [team] = await getDb().select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  return team
}

async function requireTeamManager(requesterId: string, clubId: string, teamId: string): Promise<UserRoles> {
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, clubId) && !isActiveStaffOfTeam(roles, teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
  }
  return roles
}

/** Viewers: team players, active staff, admins, and parents of a player in the team. */
async function requireTeamViewer(requesterId: string, clubId: string, teamId: string) {
  const roles = await getUserRoles(requesterId)
  if (isClubAdmin(roles, clubId) || isActiveStaffOfTeam(roles, teamId) || roles.playerTeamId === teamId) return
  if (roles.parentOfUserIds.length > 0) {
    const kids = await getDb().select({ id: playerRegistrations.userId }).from(playerRegistrations)
      .where(eq(playerRegistrations.teamId, teamId))
    const kidIds = new Set(kids.map(k => k.id))
    if (roles.parentOfUserIds.some(id => kidIds.has(id))) return
  }
  throw createError({ statusCode: 403, statusMessage: 'Not a member, parent, or manager of this team' })
}

/** All closures that apply to this team: club-level (teamId null) + the team's own. */
async function applicableClosures(clubId: string, teamId: string): Promise<DateRange[]> {
  const rows = await getDb().select({
    startDate: noTrainingPeriods.startDate, endDate: noTrainingPeriods.endDate
  }).from(noTrainingPeriods)
    .where(and(
      eq(noTrainingPeriods.clubId, clubId),
      or(isNull(noTrainingPeriods.teamId), eq(noTrainingPeriods.teamId, teamId))
    ))
  return rows
}

async function validateSessionRefs(clubId: string, teamId: string, locationId: string, trainerUserId?: string | null) {
  const db = getDb()
  const [loc] = await db.select().from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.clubId, clubId)))
  if (!loc) throw createError({ statusCode: 404, statusMessage: 'Location not found' })
  if (trainerUserId) {
    const [assignment] = await db.select().from(staffAssignments)
      .where(and(
        eq(staffAssignments.teamId, teamId),
        eq(staffAssignments.userId, trainerUserId),
        eq(staffAssignments.status, 'active')
      ))
    if (!assignment) {
      throw createError({ statusCode: 400, statusMessage: 'Trainer must be an active staff member of this team' })
    }
  }
}

function validateTimes(startTime: string, endTime: string) {
  if (endTime <= startTime) {
    throw createError({ statusCode: 400, statusMessage: 'End time must be after start time' })
  }
}

// --- Weekly slots ---

/**
 * Create a weekly slot and materialize its sessions for the season (from
 * max(season start, `generateFrom`, today), skipping applicable no-training periods).
 */
export async function createSlot(requesterId: string, teamId: string, input: {
  seasonId: string
  weekday: number
  startTime: string
  endTime: string
  locationId: string
  trainerUserId?: string | null
  generateFrom?: string
}) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  validateTimes(input.startTime, input.endTime)
  const db = getDb()
  const [season] = await db.select().from(seasons)
    .where(and(eq(seasons.id, input.seasonId), eq(seasons.clubId, team.clubId)))
  if (!season) throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  await validateSessionRefs(team.clubId, teamId, input.locationId, input.trainerUserId)
  const [slot] = await db.insert(trainingSlots).values({
    clubId: team.clubId,
    teamId,
    seasonId: season.id,
    weekday: input.weekday,
    startTime: input.startTime,
    endTime: input.endTime,
    locationId: input.locationId,
    trainerUserId: input.trainerUserId ?? null
  }).returning()
  const closures = await applicableClosures(team.clubId, teamId)
  const from = [input.generateFrom ?? today(), today()].sort()[1]!
  const dates = slotSessionDates({
    weekday: input.weekday,
    seasonStart: season.startDate,
    seasonEnd: season.endDate,
    from,
    closures
  })
  if (dates.length > 0) {
    await db.insert(trainingSessions).values(dates.map(date => ({
      clubId: team.clubId,
      teamId,
      slotId: slot!.id,
      date,
      startTime: input.startTime,
      endTime: input.endTime,
      locationId: input.locationId,
      trainerUserId: input.trainerUserId ?? null
    })))
  }
  return { slot: slot!, sessionsCreated: dates.length }
}

export async function listSlots(requesterId: string, teamId: string) {
  const team = await getTeamOr404(teamId)
  await requireTeamViewer(requesterId, team.clubId, teamId)
  return getDb().select().from(trainingSlots)
    .where(eq(trainingSlots.teamId, teamId))
    .orderBy(asc(trainingSlots.weekday), asc(trainingSlots.startTime))
}

/**
 * Update a slot; its FUTURE sessions are regenerated to match (past sessions keep
 * their history). Manually-cancelled future sessions of this slot are regenerated
 * as scheduled - the schedule changed, old cancellations belong to the old times.
 * Dates inside no-training periods stay excluded.
 */
export async function updateSlot(requesterId: string, slotId: string, patch: {
  weekday?: number
  startTime?: string
  endTime?: string
  locationId?: string
  trainerUserId?: string | null
  generateFrom?: string
}) {
  const db = getDb()
  const [slot] = await db.select().from(trainingSlots).where(eq(trainingSlots.id, slotId))
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  await requireTeamManager(requesterId, slot.clubId, slot.teamId)
  const next = {
    weekday: patch.weekday ?? slot.weekday,
    startTime: patch.startTime ?? slot.startTime,
    endTime: patch.endTime ?? slot.endTime,
    locationId: patch.locationId ?? slot.locationId,
    trainerUserId: patch.trainerUserId !== undefined ? patch.trainerUserId : slot.trainerUserId
  }
  validateTimes(next.startTime, next.endTime)
  await validateSessionRefs(slot.clubId, slot.teamId, next.locationId, next.trainerUserId)
  const [updated] = await db.update(trainingSlots).set(next)
    .where(eq(trainingSlots.id, slotId)).returning()
  const [season] = await db.select().from(seasons).where(eq(seasons.id, slot.seasonId))
  const from = [patch.generateFrom ?? today(), today()].sort()[1]!
  await db.delete(trainingSessions)
    .where(and(eq(trainingSessions.slotId, slotId), gte(trainingSessions.date, from)))
  const closures = await applicableClosures(slot.clubId, slot.teamId)
  const dates = slotSessionDates({
    weekday: next.weekday,
    seasonStart: season!.startDate,
    seasonEnd: season!.endDate,
    from,
    closures
  })
  if (dates.length > 0) {
    await db.insert(trainingSessions).values(dates.map(date => ({
      clubId: slot.clubId,
      teamId: slot.teamId,
      slotId,
      date,
      startTime: next.startTime,
      endTime: next.endTime,
      locationId: next.locationId,
      trainerUserId: next.trainerUserId
    })))
  }
  return { slot: updated!, sessionsRegenerated: dates.length }
}

/** Delete a slot; future sessions go with it, past ones keep their history (slotId nulls out). */
export async function deleteSlot(requesterId: string, slotId: string, from?: string) {
  const db = getDb()
  const [slot] = await db.select().from(trainingSlots).where(eq(trainingSlots.id, slotId))
  if (!slot) throw createError({ statusCode: 404, statusMessage: 'Slot not found' })
  await requireTeamManager(requesterId, slot.clubId, slot.teamId)
  const cutoff = [from ?? today(), today()].sort()[1]!
  await db.delete(trainingSessions)
    .where(and(eq(trainingSessions.slotId, slotId), gte(trainingSessions.date, cutoff)))
  await db.delete(trainingSlots).where(eq(trainingSlots.id, slotId))
  return { removed: true }
}

// --- Sessions (one-off create, edit, cancel/reinstate, list) ---

/** One-off session. Blocked (409) on dates inside an applicable no-training period. */
export async function createOneOffSession(requesterId: string, teamId: string, input: {
  date: string
  startTime: string
  endTime: string
  locationId: string
  trainerUserId?: string | null
}) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  validateTimes(input.startTime, input.endTime)
  await validateSessionRefs(team.clubId, teamId, input.locationId, input.trainerUserId)
  const closures = await applicableClosures(team.clubId, teamId)
  if (inAnyRange(input.date, closures)) {
    throw createError({ statusCode: 409, statusMessage: 'This date falls in a no-training period' })
  }
  const [session] = await getDb().insert(trainingSessions).values({
    clubId: team.clubId,
    teamId,
    slotId: null,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    locationId: input.locationId,
    trainerUserId: input.trainerUserId ?? null
  }).returning()
  return session!
}

/**
 * Edit or cancel/reinstate a session. Cancelling requires a reason (visible to the
 * team). Reinstating or moving a session onto a date inside an applicable
 * no-training period is a 409 - a team can never supersede admin boundaries.
 */
export async function updateSession(requesterId: string, sessionId: string, patch: {
  date?: string
  startTime?: string
  endTime?: string
  locationId?: string
  trainerUserId?: string | null
  status?: 'scheduled' | 'cancelled'
  cancelReason?: string
}) {
  const db = getDb()
  const [session] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, sessionId))
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  await requireTeamManager(requesterId, session.clubId, session.teamId)
  const next = {
    date: patch.date ?? session.date,
    startTime: patch.startTime ?? session.startTime,
    endTime: patch.endTime ?? session.endTime,
    locationId: patch.locationId ?? session.locationId,
    trainerUserId: patch.trainerUserId !== undefined ? patch.trainerUserId : session.trainerUserId,
    status: patch.status ?? session.status,
    cancelReason: session.cancelReason as string | null
  }
  validateTimes(next.startTime, next.endTime)
  await validateSessionRefs(session.clubId, session.teamId, next.locationId, next.trainerUserId)
  if (patch.status === 'cancelled') {
    const reason = patch.cancelReason?.trim()
    if (!reason) throw createError({ statusCode: 400, statusMessage: 'Cancelling requires a reason' })
    next.cancelReason = reason
  }
  if (patch.status === 'scheduled') next.cancelReason = null
  const closures = await applicableClosures(session.clubId, session.teamId)
  if (next.status === 'scheduled' && inAnyRange(next.date, closures)) {
    throw createError({ statusCode: 409, statusMessage: 'This date falls in a no-training period' })
  }
  const [updated] = await db.update(trainingSessions).set(next)
    .where(eq(trainingSessions.id, sessionId)).returning()
  return updated!
}

/**
 * F11: the member's own upcoming schedule across every team they are involved with -
 * as player (one team), staff (all their teams), and/or parent (their kids' teams).
 * One entry per team with the member's roles on it; sessions include cancelled ones.
 */
export async function getMySchedule(userId: string, opts: { from?: string } = {}) {
  const db = getDb()
  const roles = await getUserRoles(userId)
  const teamRoles = new Map<string, Set<string>>()
  const addRole = (teamId: string, role: string) => {
    if (!teamRoles.has(teamId)) teamRoles.set(teamId, new Set())
    teamRoles.get(teamId)!.add(role)
  }
  if (roles.playerTeamId) addRole(roles.playerTeamId, 'player')
  for (const teamId of roles.staffTeamIds) addRole(teamId, 'staff')
  if (roles.parentOfUserIds.length > 0) {
    const kidRegs = await db.select({ teamId: playerRegistrations.teamId, userId: playerRegistrations.userId })
      .from(playerRegistrations)
      .where(inArray(playerRegistrations.userId, roles.parentOfUserIds))
    for (const reg of kidRegs) addRole(reg.teamId, 'parent')
  }
  if (teamRoles.size === 0) return []
  const teamIds = [...teamRoles.keys()]
  const teamRows = await db.select().from(teams).where(inArray(teams.id, teamIds))
  const trainer = alias(user, 'trainer')
  const from = opts.from ?? today()
  const sessions = await db.select({
    id: trainingSessions.id,
    teamId: trainingSessions.teamId,
    date: trainingSessions.date,
    startTime: trainingSessions.startTime,
    endTime: trainingSessions.endTime,
    status: trainingSessions.status,
    cancelReason: trainingSessions.cancelReason,
    locationName: locations.name,
    trainerName: trainer.name
  }).from(trainingSessions)
    .innerJoin(locations, eq(trainingSessions.locationId, locations.id))
    .leftJoin(trainer, eq(trainingSessions.trainerUserId, trainer.id))
    .where(and(inArray(trainingSessions.teamId, teamIds), gte(trainingSessions.date, from)))
    .orderBy(asc(trainingSessions.date), asc(trainingSessions.startTime))
  return teamRows.map(team => ({
    team: { id: team.id, name: team.name },
    myRoles: [...teamRoles.get(team.id)!].sort(),
    sessions: sessions.filter(s => s.teamId === team.id)
  }))
}

/** Team schedule (incl. cancelled sessions - they stay visible). Viewers per requireTeamViewer. */
export async function listTeamSessions(requesterId: string, teamId: string, opts: { from?: string } = {}) {
  const team = await getTeamOr404(teamId)
  await requireTeamViewer(requesterId, team.clubId, teamId)
  const trainer = alias(user, 'trainer')
  const from = opts.from ?? today()
  return getDb().select({
    id: trainingSessions.id,
    date: trainingSessions.date,
    startTime: trainingSessions.startTime,
    endTime: trainingSessions.endTime,
    status: trainingSessions.status,
    cancelReason: trainingSessions.cancelReason,
    slotId: trainingSessions.slotId,
    locationId: trainingSessions.locationId,
    locationName: locations.name,
    trainerUserId: trainingSessions.trainerUserId,
    trainerName: trainer.name
  }).from(trainingSessions)
    .innerJoin(locations, eq(trainingSessions.locationId, locations.id))
    .leftJoin(trainer, eq(trainingSessions.trainerUserId, trainer.id))
    .where(and(eq(trainingSessions.teamId, teamId), gte(trainingSessions.date, from)))
    .orderBy(asc(trainingSessions.date), asc(trainingSessions.startTime))
}
