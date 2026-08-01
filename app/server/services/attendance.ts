import { createError } from 'h3'
import { eq, and, lt, inArray, asc } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam } from '../utils/roles'
import { classifyAbsence, sessionStart } from '../utils/absence-rules'
import { canManageAttendanceFor } from './parents'
import { getTeamOr404, requireTeamManager } from './trainings'
import { absences, trainingSessions, playerRegistrations, user } from '../db/schema'

async function getSessionOr404(sessionId: string) {
  const [session] = await getDb().select().from(trainingSessions)
    .where(eq(trainingSessions.id, sessionId))
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  return session
}

async function requirePlayerInTeam(playerUserId: string, teamId: string) {
  const [reg] = await getDb().select().from(playerRegistrations)
    .where(and(eq(playerRegistrations.userId, playerUserId), eq(playerRegistrations.teamId, teamId)))
  if (!reg) throw createError({ statusCode: 404, statusMessage: 'This player is not registered with the session team' })
}

/**
 * F13: actively report an absence (opt-out model). Allowed for the player themself
 * or a linked parent, per the F5 age rules. Classification is fixed at report time.
 * `at` is injectable for tests; defaults to now.
 */
export async function reportAbsence(
  actorId: string,
  sessionId: string,
  playerUserId: string,
  opts: { reason?: string, at?: Date } = {}
) {
  const session = await getSessionOr404(sessionId)
  if (session.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Session is cancelled - no absence needed' })
  }
  await requirePlayerInTeam(playerUserId, session.teamId)
  if (!(await canManageAttendanceFor(actorId, playerUserId))) {
    throw createError({ statusCode: 403, statusMessage: 'You may not manage attendance for this player (F5 age rules)' })
  }
  const at = opts.at ?? new Date()
  const classification = classifyAbsence(session.date, session.startTime, at)
  const db = getDb()
  const existing = await db.select().from(absences)
    .where(and(eq(absences.sessionId, sessionId), eq(absences.playerUserId, playerUserId)))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Absence already reported for this session' })
  }
  const [absence] = await db.insert(absences).values({
    clubId: session.clubId,
    teamId: session.teamId,
    sessionId,
    playerUserId,
    reportedByUserId: actorId,
    classification,
    source: 'reported',
    reason: opts.reason?.trim() || null,
    reportedAt: at
  }).returning()
  return absence!
}

/**
 * Withdraw an absence (the player is available again). Allowed before session start
 * for whoever may manage the player's attendance; staff/admin may remove anytime
 * (that is the F13 "correct actuals" path).
 */
export async function withdrawAbsence(actorId: string, absenceId: string, opts: { at?: Date } = {}) {
  const db = getDb()
  const [absence] = await db.select().from(absences).where(eq(absences.id, absenceId))
  if (!absence) throw createError({ statusCode: 404, statusMessage: 'Absence not found' })
  const roles = await getUserRoles(actorId)
  const isManager = isClubAdmin(roles, absence.clubId) || isActiveStaffOfTeam(roles, absence.teamId)
  if (!isManager) {
    if (!(await canManageAttendanceFor(actorId, absence.playerUserId))) {
      throw createError({ statusCode: 403, statusMessage: 'You may not manage attendance for this player' })
    }
    const session = await getSessionOr404(absence.sessionId)
    const at = opts.at ?? new Date()
    if (at >= sessionStart(session.date, session.startTime)) {
      throw createError({ statusCode: 409, statusMessage: 'Session already started - ask the staff to correct it' })
    }
  }
  await db.delete(absences).where(eq(absences.id, absenceId))
  return { removed: true }
}

/**
 * F13 staff correction: record a no-show after the session started (a player who
 * was absent without reporting). Staff/admin only; before start it is a 409.
 */
export async function recordNoShow(
  actorId: string,
  sessionId: string,
  playerUserId: string,
  opts: { reason?: string, at?: Date } = {}
) {
  const session = await getSessionOr404(sessionId)
  await requireTeamManager(actorId, session.clubId, session.teamId)
  await requirePlayerInTeam(playerUserId, session.teamId)
  const at = opts.at ?? new Date()
  if (at < sessionStart(session.date, session.startTime)) {
    throw createError({ statusCode: 409, statusMessage: 'Session has not started yet - no-shows are recorded afterwards' })
  }
  const db = getDb()
  const existing = await db.select().from(absences)
    .where(and(eq(absences.sessionId, sessionId), eq(absences.playerUserId, playerUserId)))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'An absence is already recorded for this player and session' })
  }
  const [absence] = await db.insert(absences).values({
    clubId: session.clubId,
    teamId: session.teamId,
    sessionId,
    playerUserId,
    reportedByUserId: actorId,
    classification: 'no-show',
    source: 'staff',
    reason: opts.reason?.trim() || null,
    reportedAt: at
  }).returning()
  return absence!
}

/** Absences for a set of sessions, with player names - the transparency payload. */
export async function absencesForSessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, { id: string, playerUserId: string, playerName: string, classification: string, reason: string | null }[]>()
  const player = alias(user, 'player')
  const rows = await getDb().select({
    id: absences.id,
    sessionId: absences.sessionId,
    playerUserId: absences.playerUserId,
    playerName: player.name,
    classification: absences.classification,
    reason: absences.reason
  }).from(absences)
    .innerJoin(player, eq(absences.playerUserId, player.id))
    .where(inArray(absences.sessionId, sessionIds))
    .orderBy(asc(player.name))
  const map = new Map<string, { id: string, playerUserId: string, playerName: string, classification: string, reason: string | null }[]>()
  for (const r of rows) {
    if (!map.has(r.sessionId)) map.set(r.sessionId, [])
    map.get(r.sessionId)!.push({
      id: r.id, playerUserId: r.playerUserId, playerName: r.playerName,
      classification: r.classification, reason: r.reason
    })
  }
  return map
}

/**
 * F15: per-player training attendance for the team roster - transparent to every
 * team viewer. Counts PAST scheduled trainings only (matches and cancelled
 * sessions do not count toward the percentage).
 */
export async function attendanceStats(requesterId: string, teamId: string, opts: { until?: string } = {}) {
  const team = await getTeamOr404(teamId)
  // same visibility as the schedule: players, staff, admin, parents of team players
  const roles = await getUserRoles(requesterId)
  const db = getDb()
  const isViewer = isClubAdmin(roles, team.clubId)
    || isActiveStaffOfTeam(roles, teamId)
    || roles.playerTeamId === teamId
  let allowed = isViewer
  if (!allowed && roles.parentOfUserIds.length > 0) {
    const kids = await db.select({ id: playerRegistrations.userId }).from(playerRegistrations)
      .where(eq(playerRegistrations.teamId, teamId))
    const kidIds = new Set(kids.map(k => k.id))
    allowed = roles.parentOfUserIds.some(id => kidIds.has(id))
  }
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member, parent, or manager of this team' })
  }
  const until = opts.until ?? new Date().toISOString().slice(0, 10)
  const pastTrainings = await db.select({ id: trainingSessions.id }).from(trainingSessions)
    .where(and(
      eq(trainingSessions.teamId, teamId),
      eq(trainingSessions.type, 'training'),
      eq(trainingSessions.status, 'scheduled'),
      lt(trainingSessions.date, until)
    ))
  const sessionIds = pastTrainings.map(s => s.id)
  const players = await db.select({ userId: user.id, name: user.name }).from(playerRegistrations)
    .innerJoin(user, eq(playerRegistrations.userId, user.id))
    .where(eq(playerRegistrations.teamId, teamId))
    .orderBy(asc(user.name))
  const absenceRows = sessionIds.length > 0
    ? await db.select({
        playerUserId: absences.playerUserId,
        classification: absences.classification
      }).from(absences).where(inArray(absences.sessionId, sessionIds))
    : []
  return {
    totalTrainings: sessionIds.length,
    players: players.map((p) => {
      const mine = absenceRows.filter(a => a.playerUserId === p.userId)
      const counts = {
        timely: mine.filter(a => a.classification === 'timely').length,
        late: mine.filter(a => a.classification === 'late').length,
        noShow: mine.filter(a => a.classification === 'no-show').length
      }
      const absent = mine.length
      const attended = Math.max(sessionIds.length - absent, 0)
      return {
        userId: p.userId,
        name: p.name,
        attended,
        absent,
        counts,
        percentage: sessionIds.length > 0 ? Math.round((attended / sessionIds.length) * 100) : null
      }
    })
  }
}
