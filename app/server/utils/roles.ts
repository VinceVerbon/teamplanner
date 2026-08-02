import { eq, and } from 'drizzle-orm'
import { getDb } from './db'
import { user, clubs, clubAdmins, staffAssignments, playerRegistrations, parentLinks } from '../db/schema'

export interface UserRoles {
  adminOfClubIds: string[]
  /** Active staff assignments only - pending ones grant nothing yet (F8). */
  staffTeamIds: string[]
  pendingStaffTeamIds: string[]
  /** A player is registered with exactly one team, or none. */
  playerTeamId: string | null
  /** Active parent links only (F5). */
  parentOfUserIds: string[]
}

export async function getUserRoles(userId: string): Promise<UserRoles> {
  const db = getDb()
  const [admins, staff, player, parents, [self]] = await Promise.all([
    db.select({ clubId: clubAdmins.clubId }).from(clubAdmins).where(eq(clubAdmins.userId, userId)),
    db.select({ teamId: staffAssignments.teamId, status: staffAssignments.status })
      .from(staffAssignments).where(eq(staffAssignments.userId, userId)),
    db.select({ teamId: playerRegistrations.teamId })
      .from(playerRegistrations).where(eq(playerRegistrations.userId, userId)),
    db.select({ playerUserId: parentLinks.playerUserId })
      .from(parentLinks)
      .where(and(eq(parentLinks.parentUserId, userId), eq(parentLinks.status, 'active'))),
    db.select({ isBootstrapAdmin: user.isBootstrapAdmin }).from(user).where(eq(user.id, userId))
  ])
  let adminClubIds = admins.map(a => a.clubId)
  // F22: the seeded bootstrap admin administers every club of this deployment (v1: the
  // single club) without needing club_admins rows.
  if (self?.isBootstrapAdmin) {
    const allClubs = await db.select({ id: clubs.id }).from(clubs)
    adminClubIds = [...new Set([...adminClubIds, ...allClubs.map(c => c.id)])]
  }
  return {
    adminOfClubIds: adminClubIds,
    staffTeamIds: staff.filter(s => s.status === 'active').map(s => s.teamId),
    pendingStaffTeamIds: staff.filter(s => s.status === 'pending').map(s => s.teamId),
    playerTeamId: player[0]?.teamId ?? null,
    parentOfUserIds: parents.map(p => p.playerUserId)
  }
}

export function isClubAdmin(roles: UserRoles, clubId: string): boolean {
  return roles.adminOfClubIds.includes(clubId)
}

export function isActiveStaffOfTeam(roles: UserRoles, teamId: string): boolean {
  return roles.staffTeamIds.includes(teamId)
}

export function isPlayerOfTeam(roles: UserRoles, teamId: string): boolean {
  return roles.playerTeamId === teamId
}

export function isParentOf(roles: UserRoles, playerUserId: string): boolean {
  return roles.parentOfUserIds.includes(playerUserId)
}
