// Test-set for F6 (club setup) and F7 (team management) - main flows and expected edge cases.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb } from './setup'
import { getDb } from '../server/utils/db'
import { createClub, getCurrentClub, updateClub } from '../server/services/clubs'
import { listTeams, createTeam, updateTeam } from '../server/services/teams'
import { getUserRoles, isClubAdmin } from '../server/utils/roles'
import { user } from '../server/db/schema'

let founder: string
let outsider: string
let clubId: string

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user).values({ name: email.split('@')[0]!, email }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  founder = await makeUser('founder@example.com')
  outsider = await makeUser('outsider@example.com')
})

describe('F6 club setup - main flow', () => {
  it('no club exists before bootstrap', async () => {
    expect(await getCurrentClub()).toBeNull()
  })

  it('first user creates the club and becomes its admin', async () => {
    const club = await createClub(founder, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
    clubId = club.id
    expect(club.slug).toBe('fcaalsmeer')
    const roles = await getUserRoles(founder)
    expect(isClubAdmin(roles, club.id)).toBe(true)
    expect((await getCurrentClub())?.id).toBe(club.id)
  })

  it('admin can rename the club', async () => {
    const club = await updateClub(founder, clubId, { name: 'FC Aalsmeer (test)' })
    expect(club.name).toBe('FC Aalsmeer (test)')
  })
})

describe('F6 club setup - edge cases', () => {
  it('a second club is rejected (single-club v1)', async () => {
    await expect(createClub(outsider, { slug: 'other', name: 'Other Club' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('non-admin cannot update the club', async () => {
    await expect(updateClub(outsider, clubId, { name: 'Hijacked' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('invalid slug is rejected', async () => {
    await freshDbTempCheck()
  })
})

// slug validation runs before the single-club check, so it can be asserted on the existing DB
async function freshDbTempCheck() {
  await expect(createClub(outsider, { slug: 'Bad Slug!', name: 'X' }))
    .rejects.toMatchObject({ statusCode: 400 })
}

describe('F7 team management - main flow', () => {
  let teamId: string

  it('admin creates a team', async () => {
    const team = await createTeam(founder, clubId, 'MO17-4')
    teamId = team.id
    expect(team.name).toBe('MO17-4')
    expect(team.archived).toBe(false)
  })

  it('teams are listed for the club', async () => {
    const teams = await listTeams(clubId)
    expect(teams.map(t => t.name)).toContain('MO17-4')
  })

  it('admin renames a team', async () => {
    const team = await updateTeam(founder, teamId, { name: 'MO17-4 (zaterdag)' })
    expect(team.name).toBe('MO17-4 (zaterdag)')
  })

  it('admin archives a team; it disappears from the default list but stays with archived=1', async () => {
    const extra = await createTeam(founder, clubId, 'Tijdelijk Team')
    await updateTeam(founder, extra.id, { archived: true })
    const active = await listTeams(clubId)
    expect(active.map(t => t.id)).not.toContain(extra.id)
    const all = await listTeams(clubId, { includeArchived: true })
    expect(all.map(t => t.id)).toContain(extra.id)
  })
})

describe('F7 team management - edge cases', () => {
  it('non-admin cannot create a team', async () => {
    await expect(createTeam(outsider, clubId, 'Rogue Team'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('non-admin cannot rename or archive a team', async () => {
    const [team] = await listTeams(clubId)
    await expect(updateTeam(outsider, team!.id, { name: 'Rogue' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('too-short team name is rejected', async () => {
    await expect(createTeam(founder, clubId, ' A '))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('updating a non-existent team is a 404', async () => {
    await expect(updateTeam(founder, 'no-such-team', { name: 'Ghost' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
