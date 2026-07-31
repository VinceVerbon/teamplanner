import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam, type UserRoles } from '../utils/roles'
import { user, teams, staffAssignments, playerRegistrations } from '../db/schema'

async function getTeamOr404(teamId: string) {
  const db = getDb()
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  return team
}

function canManageTeam(roles: UserRoles, clubId: string, teamId: string): boolean {
  return isClubAdmin(roles, clubId) || isActiveStaffOfTeam(roles, teamId)
}

async function findUserByEmail(email: string) {
  const db = getDb()
  const [found] = await db.select({ id: user.id, name: user.name, email: user.email })
    .from(user).where(eq(user.email, email.trim().toLowerCase()))
  return found ?? null
}

/** Admins and active staff may look up a registered identity by exact email (F8: "once the identity has registered"). */
export async function lookupUserByEmail(requesterId: string, clubId: string, email: string) {
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, clubId) && roles.staffTeamIds.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or staff role required' })
  }
  return findUserByEmail(email)
}

export async function listTeamMembers(requesterId: string, teamId: string) {
  const team = await getTeamOr404(teamId)
  const roles = await getUserRoles(requesterId)
  // Team members see their team; managers see it too.
  const isMember = roles.playerTeamId === teamId
  if (!isMember && !canManageTeam(roles, team.clubId, teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Not a member or manager of this team' })
  }
  const db = getDb()
  const players = await db.select({
    userId: user.id, name: user.name, email: user.email, dateOfBirth: user.dateOfBirth
  }).from(playerRegistrations)
    .innerJoin(user, eq(playerRegistrations.userId, user.id))
    .where(eq(playerRegistrations.teamId, teamId))
    .orderBy(user.name)
  const staff = await db.select({
    assignmentId: staffAssignments.id, userId: user.id, name: user.name, email: user.email,
    status: staffAssignments.status
  }).from(staffAssignments)
    .innerJoin(user, eq(staffAssignments.userId, user.id))
    .where(eq(staffAssignments.teamId, teamId))
    .orderBy(user.name)
  return { team, players, staff }
}

/** Admin only: register a player (by registered email) with this team. A player has exactly one team. */
export async function assignPlayer(requesterId: string, teamId: string, email: string) {
  const team = await getTeamOr404(teamId)
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, team.clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const target = await findUserByEmail(email)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No registered account with this email' })
  const db = getDb()
  const existing = await db.select().from(playerRegistrations).where(eq(playerRegistrations.userId, target.id))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'This person is already registered as player with a team' })
  }
  const [reg] = await db.insert(playerRegistrations)
    .values({ clubId: team.clubId, teamId, userId: target.id }).returning()
  return reg!
}

export async function removePlayer(requesterId: string, teamId: string, targetUserId: string) {
  const team = await getTeamOr404(teamId)
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, team.clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const db = getDb()
  const deleted = await db.delete(playerRegistrations)
    .where(and(eq(playerRegistrations.teamId, teamId), eq(playerRegistrations.userId, targetUserId)))
    .returning()
  if (deleted.length === 0) throw createError({ statusCode: 404, statusMessage: 'Player registration not found' })
  return { removed: true }
}

/**
 * Add a staff member (by registered email) to a team (F8):
 * - admin -> assignment is 'active' immediately;
 * - existing ACTIVE team staff -> assignment is 'pending' until an admin verifies.
 */
export async function addStaff(requesterId: string, teamId: string, email: string) {
  const team = await getTeamOr404(teamId)
  const roles = await getUserRoles(requesterId)
  const admin = isClubAdmin(roles, team.clubId)
  if (!admin && !isActiveStaffOfTeam(roles, teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
  }
  const target = await findUserByEmail(email)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No registered account with this email' })
  const db = getDb()
  const existing = await db.select().from(staffAssignments)
    .where(and(eq(staffAssignments.teamId, teamId), eq(staffAssignments.userId, target.id)))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Already assigned as staff on this team' })
  }
  const [assignment] = await db.insert(staffAssignments)
    .values({ clubId: team.clubId, teamId, userId: target.id, status: admin ? 'active' : 'pending' })
    .returning()
  return assignment!
}

/** Admin only: verify a pending staff assignment (F8). */
export async function verifyStaff(requesterId: string, assignmentId: string) {
  const db = getDb()
  const [assignment] = await db.select().from(staffAssignments).where(eq(staffAssignments.id, assignmentId))
  if (!assignment) throw createError({ statusCode: 404, statusMessage: 'Staff assignment not found' })
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, assignment.clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const [updated] = await db.update(staffAssignments)
    .set({ status: 'active' })
    .where(eq(staffAssignments.id, assignmentId))
    .returning()
  return updated!
}

/** Admin only: remove a staff assignment (also how a pending request is rejected). */
export async function removeStaff(requesterId: string, assignmentId: string) {
  const db = getDb()
  const [assignment] = await db.select().from(staffAssignments).where(eq(staffAssignments.id, assignmentId))
  if (!assignment) throw createError({ statusCode: 404, statusMessage: 'Staff assignment not found' })
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, assignment.clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  await db.delete(staffAssignments).where(eq(staffAssignments.id, assignmentId))
  return { removed: true }
}
