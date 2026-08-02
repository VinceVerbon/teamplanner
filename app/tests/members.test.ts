// Test-set for F8 (member administration) - main flows and expected edge cases.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import {
  lookupUserByEmail, listTeamMembers, assignPlayer, removePlayer,
  addStaff, verifyStaff, removeStaff
} from '../server/services/members'
import { user } from '../server/db/schema'

let admin: string
let coach: string
let player1: string
let outsider: string
let clubId: string
let teamA: string
let teamB: string

async function makeUser(email: string): Promise<string> {
  // DOB present by default: players cannot be registered without one (F5).
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: '2009-03-01' }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  coach = await makeUser('coach@example.com')
  player1 = await makeUser('player1@example.com')
  outsider = await makeUser('outsider@example.com')
  await makeUser('player2@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  teamA = (await createTeam(admin, clubId, 'MO17-4')).id
  teamB = (await createTeam(admin, clubId, 'MO15-2')).id
})

describe('F8 member administration - main flows', () => {
  it('admin adds staff directly as active', async () => {
    const assignment = await addStaff(admin, teamA, 'coach@example.com')
    expect(assignment.status).toBe('active')
  })

  it('admin assigns a registered player by email', async () => {
    const reg = await assignPlayer(admin, teamA, 'player1@example.com')
    expect(reg.teamId).toBe(teamA)
  })

  it('active team staff adds another staff member -> pending until admin verifies', async () => {
    const pending = await addStaff(coach, teamA, 'player2@example.com')
    expect(pending.status).toBe('pending')
    const verified = await verifyStaff(admin, pending.id)
    expect(verified.status).toBe('active')
  })

  it('team members list shows players and staff with status', async () => {
    const { team, players, staff } = await listTeamMembers(admin, teamA)
    expect(team.id).toBe(teamA)
    expect(players.map(p => p.email)).toContain('player1@example.com')
    expect(staff.map(s => s.email)).toContain('coach@example.com')
  })

  it('a player can view their own team members', async () => {
    const { players } = await listTeamMembers(player1, teamA)
    expect(players.map(p => p.email)).toContain('player1@example.com')
  })

  it('admin/staff can look up a registered identity by email', async () => {
    const found = await lookupUserByEmail(admin, clubId, 'player2@example.com')
    expect(found?.email).toBe('player2@example.com')
    const notFound = await lookupUserByEmail(coach, clubId, 'ghost@example.com')
    expect(notFound).toBeNull()
  })

  it('admin removes a player from the team', async () => {
    const res = await removePlayer(admin, teamA, player1)
    expect(res.removed).toBe(true)
    const { players } = await listTeamMembers(admin, teamA)
    expect(players.map(p => p.userId)).not.toContain(player1)
    // re-assign for later tests
    await assignPlayer(admin, teamA, 'player1@example.com')
  })
})

describe('F8 member administration - edge cases', () => {
  it('a player already registered with a team cannot be assigned to a second team (409)', async () => {
    await expect(assignPlayer(admin, teamB, 'player1@example.com'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('assigning an unregistered email is a 404 (identity must exist first)', async () => {
    await expect(assignPlayer(admin, teamA, 'notregistered@example.com'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('staff cannot assign players (admin only)', async () => {
    await expect(assignPlayer(coach, teamA, 'player2@example.com'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('PENDING staff cannot add other staff (must be active)', async () => {
    const pending = await addStaff(coach, teamA, 'outsider@example.com')
    expect(pending.status).toBe('pending')
    await expect(addStaff(outsider, teamA, 'player2@example.com'))
      .rejects.toMatchObject({ statusCode: 403 })
    await removeStaff(admin, pending.id) // reject the request again
  })

  it('staff of team A cannot add staff to team B', async () => {
    await expect(addStaff(coach, teamB, 'player2@example.com'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('duplicate staff assignment on the same team is a 409', async () => {
    await expect(addStaff(admin, teamA, 'coach@example.com'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('only admin can verify pending staff', async () => {
    const pending = await addStaff(coach, teamA, 'outsider@example.com')
    await expect(verifyStaff(coach, pending.id)).rejects.toMatchObject({ statusCode: 403 })
    await removeStaff(admin, pending.id)
  })

  it('only admin can remove staff assignments', async () => {
    const pending = await addStaff(coach, teamA, 'outsider@example.com')
    await expect(removeStaff(coach, pending.id)).rejects.toMatchObject({ statusCode: 403 })
    await removeStaff(admin, pending.id)
  })

  it('outsider cannot view team members or use lookup', async () => {
    await expect(listTeamMembers(outsider, teamA)).rejects.toMatchObject({ statusCode: 403 })
    await expect(lookupUserByEmail(outsider, clubId, 'player1@example.com'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('member operations on a non-existent team are 404', async () => {
    await expect(listTeamMembers(admin, 'no-such-team')).rejects.toMatchObject({ statusCode: 404 })
    await expect(addStaff(admin, 'no-such-team', 'coach@example.com'))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
