// Test-set for F11 (upcoming schedule view): getMySchedule across roles.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer } from '../server/services/members'
import { createSeason, createLocation } from '../server/services/schedule'
import { createSlot, createOneOffSession, updateSession, getMySchedule } from '../server/services/trainings'
import { requestParentLink, confirmParentLink } from '../server/services/parents'
import { user } from '../server/db/schema'

let admin: string
let coach: string // staff on team A AND team B
let playerA: string // player in team A, also staff on team A (double role)
let parent1: string // parent of playerA
let nobody: string
let teamA: string
let teamB: string

const Y = new Date().getFullYear() + 1
const S = `${Y}-01-05`
const E = `${Y}-02-28`

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: '2009-03-01' }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  coach = await makeUser('coach@example.com')
  playerA = await makeUser('playera@example.com')
  parent1 = await makeUser('parent1@example.com')
  nobody = await makeUser('nobody@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  teamA = (await createTeam(admin, club.id, 'MO17-4')).id
  teamB = (await createTeam(admin, club.id, 'MO15-2')).id
  await addStaff(admin, teamA, 'coach@example.com')
  await addStaff(admin, teamB, 'coach@example.com')
  await assignPlayer(admin, teamA, 'playera@example.com')
  await addStaff(admin, teamA, 'playera@example.com') // player + staff on the same team
  const link = await requestParentLink(playerA, 'parent1@example.com', 'parent')
  await confirmParentLink(parent1, link.token)
  const seasonId = (await createSeason(admin, { name: `S${Y}`, startDate: S, endDate: E })).id
  const locId = (await createLocation(admin, { name: 'Hal 1' })).id
  await createSlot(coach, teamA, {
    seasonId, weekday: 2, startTime: '19:00', endTime: '20:30', locationId: locId, generateFrom: S
  })
  await createSlot(coach, teamB, {
    seasonId, weekday: 4, startTime: '18:00', endTime: '19:00', locationId: locId, generateFrom: S
  })
  const one = await createOneOffSession(coach, teamA, {
    date: `${Y}-02-07`, startTime: '10:00', endTime: '11:00', locationId: locId
  })
  await updateSession(coach, one.id, { status: 'cancelled', cancelReason: 'Hal bezet' })
})

describe('F11 my schedule', () => {
  it('a player sees their own team with upcoming sessions, oldest first', async () => {
    const schedule = await getMySchedule(playerA, { from: S })
    const entryA = schedule.find(e => e.team.id === teamA)!
    expect(entryA).toBeTruthy()
    expect(entryA.sessions.length).toBeGreaterThan(4)
    const dates = entryA.sessions.map(s => s.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('combined roles on one team are reported together (player + staff)', async () => {
    const schedule = await getMySchedule(playerA, { from: S })
    expect(schedule.find(e => e.team.id === teamA)!.myRoles).toEqual(['player', 'staff'])
    // and no duplicate team entries
    expect(schedule.filter(e => e.team.id === teamA)).toHaveLength(1)
  })

  it('staff sees ALL their teams', async () => {
    const schedule = await getMySchedule(coach, { from: S })
    expect(schedule.map(e => e.team.id).sort()).toEqual([teamA, teamB].sort())
    expect(schedule.every(e => e.myRoles.includes('staff'))).toBe(true)
  })

  it('a parent sees their child team schedule with the parent role', async () => {
    const schedule = await getMySchedule(parent1, { from: S })
    const entryA = schedule.find(e => e.team.id === teamA)!
    expect(entryA.myRoles).toEqual(['parent'])
    expect(entryA.sessions.length).toBeGreaterThan(0)
  })

  it('cancelled sessions stay visible with their reason', async () => {
    const schedule = await getMySchedule(playerA, { from: S })
    const cancelled = schedule.find(e => e.team.id === teamA)!.sessions
      .find(s => s.status === 'cancelled')!
    expect(cancelled.cancelReason).toBe('Hal bezet')
  })

  it('a user without any team involvement gets an empty schedule', async () => {
    expect(await getMySchedule(nobody, { from: S })).toEqual([])
  })

  it('the from date bounds the horizon', async () => {
    const schedule = await getMySchedule(playerA, { from: `${Y}-02-20` })
    const entryA = schedule.find(e => e.team.id === teamA)!
    expect(entryA.sessions.every(s => s.date >= `${Y}-02-20`)).toBe(true)
  })
})
