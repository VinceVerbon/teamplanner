// Test-set for F4 (roles & permissions) - main flows and expected edge cases.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb } from './setup'
import { getDb } from '../server/utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam, isPlayerOfTeam, isParentOf } from '../server/utils/roles'
import { user, clubs, teams, clubAdmins, staffAssignments, playerRegistrations, parentLinks } from '../server/db/schema'

let clubId: string
let teamA: string
let teamB: string

async function makeUser(email: string): Promise<string> {
  const db = getDb()
  const [u] = await db.insert(user).values({ name: email.split('@')[0]!, email }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  const db = getDb()
  const [club] = await db.insert(clubs).values({ slug: 'fcaalsmeer', name: 'FC Aalsmeer' }).returning()
  clubId = club!.id
  const [a] = await db.insert(teams).values({ clubId, name: 'MO17-4' }).returning()
  const [b] = await db.insert(teams).values({ clubId, name: 'MO15-2' }).returning()
  teamA = a!.id
  teamB = b!.id
})

describe('F4 roles - main flows', () => {
  it('user with no assignments has no roles', async () => {
    const uid = await makeUser('nobody@example.com')
    const roles = await getUserRoles(uid)
    expect(roles.adminOfClubIds).toEqual([])
    expect(roles.staffTeamIds).toEqual([])
    expect(roles.playerTeamId).toBeNull()
    expect(roles.parentOfUserIds).toEqual([])
  })

  it('club admin assignment is reflected', async () => {
    const uid = await makeUser('admin@example.com')
    await getDb().insert(clubAdmins).values({ clubId, userId: uid })
    const roles = await getUserRoles(uid)
    expect(isClubAdmin(roles, clubId)).toBe(true)
    expect(isClubAdmin(roles, 'other-club')).toBe(false)
  })

  it('one identity can be player in one team AND active staff on multiple teams including their own', async () => {
    const uid = await makeUser('playercoach@example.com')
    const db = getDb()
    await db.insert(playerRegistrations).values({ clubId, teamId: teamA, userId: uid })
    await db.insert(staffAssignments).values({ clubId, teamId: teamA, userId: uid, status: 'active' })
    await db.insert(staffAssignments).values({ clubId, teamId: teamB, userId: uid, status: 'active' })
    const roles = await getUserRoles(uid)
    expect(isPlayerOfTeam(roles, teamA)).toBe(true)
    expect(isActiveStaffOfTeam(roles, teamA)).toBe(true)
    expect(isActiveStaffOfTeam(roles, teamB)).toBe(true)
    expect(roles.staffTeamIds).toHaveLength(2)
  })

  it('active parent link grants parent role for that player only', async () => {
    const parent = await makeUser('parent@example.com')
    const child = await makeUser('child@example.com')
    const other = await makeUser('otherchild@example.com')
    await getDb().insert(parentLinks).values({ clubId, parentUserId: parent, playerUserId: child, requestedBy: 'player', status: 'active' })
    const roles = await getUserRoles(parent)
    expect(isParentOf(roles, child)).toBe(true)
    expect(isParentOf(roles, other)).toBe(false)
  })
})

describe('F4/F8 roles - edge cases', () => {
  it('a player cannot be registered with a second team (unique user constraint)', async () => {
    const uid = await makeUser('oneteam@example.com')
    const db = getDb()
    await db.insert(playerRegistrations).values({ clubId, teamId: teamA, userId: uid })
    await expect(
      db.insert(playerRegistrations).values({ clubId, teamId: teamB, userId: uid })
    ).rejects.toThrow()
  })

  it('pending staff assignment grants no active staff role until admin verifies (F8)', async () => {
    const uid = await makeUser('pendingstaff@example.com')
    const db = getDb()
    await db.insert(staffAssignments).values({ clubId, teamId: teamA, userId: uid, status: 'pending' })
    let roles = await getUserRoles(uid)
    expect(isActiveStaffOfTeam(roles, teamA)).toBe(false)
    expect(roles.pendingStaffTeamIds).toEqual([teamA])
    // admin verifies
    const { eq } = await import('drizzle-orm')
    await db.update(staffAssignments).set({ status: 'active' }).where(eq(staffAssignments.userId, uid))
    roles = await getUserRoles(uid)
    expect(isActiveStaffOfTeam(roles, teamA)).toBe(true)
  })

  it('duplicate staff assignment on the same team is rejected', async () => {
    const uid = await makeUser('dupstaff@example.com')
    const db = getDb()
    await db.insert(staffAssignments).values({ clubId, teamId: teamA, userId: uid, status: 'active' })
    await expect(
      db.insert(staffAssignments).values({ clubId, teamId: teamA, userId: uid, status: 'pending' })
    ).rejects.toThrow()
  })

  it('pending parent link grants nothing (F5 verification pending)', async () => {
    const parent = await makeUser('pendingparent@example.com')
    const child = await makeUser('pendingchild@example.com')
    await getDb().insert(parentLinks).values({ clubId, parentUserId: parent, playerUserId: child, requestedBy: 'player', status: 'pending' })
    const roles = await getUserRoles(parent)
    expect(isParentOf(roles, child)).toBe(false)
  })

  it('duplicate club admin assignment is rejected', async () => {
    const uid = await makeUser('dupadmin@example.com')
    const db = getDb()
    await db.insert(clubAdmins).values({ clubId, userId: uid })
    await expect(db.insert(clubAdmins).values({ clubId, userId: uid })).rejects.toThrow()
  })
})
