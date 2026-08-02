// Test-set for F10 (trainings): weekly slots -> sessions, locations, seasons,
// one-offs, edit/cancel, and two-level no-training periods.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff } from '../server/services/members'
import {
  listLocations, createLocation, updateLocation, deleteLocation,
  createSeason, createNoTrainingPeriod, deleteNoTrainingPeriod, listNoTrainingPeriods
} from '../server/services/schedule'
import {
  createSlot, listSlots, updateSlot, deleteSlot,
  createOneOffSession, updateSession, listTeamSessions
} from '../server/services/trainings'
import { slotSessionDates, isoWeekday } from '../server/utils/schedule-dates'
import { user } from '../server/db/schema'

let admin: string
let coach: string
let player: string
let outsider: string
let clubId: string
let teamA: string
let teamB: string
let seasonId: string
let hallId: string

// Season safely in the future so "generate from today" never truncates it.
const Y = new Date().getFullYear() + 1
const S = `${Y}-01-05` // a Monday-adjacent anchor; exact weekday handled by logic
const E = `${Y}-03-29`

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: '2009-03-01' }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  coach = await makeUser('coach@example.com')
  player = await makeUser('player@example.com')
  outsider = await makeUser('outsider@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  teamA = (await createTeam(admin, clubId, 'MO17-4')).id
  teamB = (await createTeam(admin, clubId, 'MO15-2')).id
  await addStaff(admin, teamA, 'coach@example.com')
  const { assignPlayer } = await import('../server/services/members')
  await assignPlayer(admin, teamA, 'player@example.com')
  seasonId = (await createSeason(admin, { name: `Voorjaar ${Y}`, startDate: S, endDate: E })).id
  hallId = (await createLocation(admin, { name: 'Sporthal De Bloemhof', address: 'Aalsmeer' })).id
})

describe('F10 schedule-dates (pure functions)', () => {
  it('generates every requested weekday within season bounds, inclusive', () => {
    const dates = slotSessionDates({ weekday: 2, seasonStart: '2027-01-04', seasonEnd: '2027-01-31' })
    expect(dates).toEqual(['2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26'])
    expect(dates.every(d => isoWeekday(d) === 2)).toBe(true)
  })

  it('respects a from date inside the season', () => {
    const dates = slotSessionDates({
      weekday: 2, seasonStart: '2027-01-04', seasonEnd: '2027-01-31', from: '2027-01-13'
    })
    expect(dates).toEqual(['2027-01-19', '2027-01-26'])
  })

  it('skips closure ranges, boundaries inclusive', () => {
    const dates = slotSessionDates({
      weekday: 2, seasonStart: '2027-01-04', seasonEnd: '2027-01-31',
      closures: [{ startDate: '2027-01-12', endDate: '2027-01-19' }]
    })
    expect(dates).toEqual(['2027-01-05', '2027-01-26'])
  })

  it('season starting on the requested weekday includes that first day', () => {
    // 2027-01-04 is a Monday
    const dates = slotSessionDates({ weekday: 1, seasonStart: '2027-01-04', seasonEnd: '2027-01-11' })
    expect(dates).toEqual(['2027-01-04', '2027-01-11'])
  })
})

describe('F10 locations & seasons', () => {
  it('admin manages locations; members read them', async () => {
    const loc = await createLocation(admin, { name: 'Veld 3' })
    const all = await listLocations()
    expect(all.map(l => l.name)).toContain('Veld 3')
    const renamed = await updateLocation(admin, loc.id, { name: 'Veld 3b' })
    expect(renamed.name).toBe('Veld 3b')
    await deleteLocation(admin, loc.id)
  })

  it('non-admin cannot manage locations or seasons', async () => {
    await expect(createLocation(coach, { name: 'X veld' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(createSeason(player, { name: 'S', startDate: S, endDate: E }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('season end before start is a 400', async () => {
    await expect(createSeason(admin, { name: 'Kapot', startDate: E, endDate: S }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('F10 weekly slots -> sessions', () => {
  it('staff creates a slot; sessions materialize within season bounds on the right weekday', async () => {
    const { slot, sessionsCreated } = await createSlot(coach, teamA, {
      seasonId, weekday: 2, startTime: '19:00', endTime: '20:30',
      locationId: hallId, trainerUserId: coach, generateFrom: S
    })
    expect(sessionsCreated).toBeGreaterThan(8)
    const sessions = await listTeamSessions(player, teamA, { from: S })
    expect(sessions.length).toBe(sessionsCreated)
    expect(sessions.every(s => isoWeekday(s.date) === 2)).toBe(true)
    expect(sessions.every(s => s.startTime === '19:00' && s.locationName === 'Sporthal De Bloemhof')).toBe(true)
    expect(sessions[0]!.trainerName).toBe('coach')
    expect((await listSlots(player, teamA)).map(s => s.id)).toContain(slot.id)
  })

  it('player and outsider cannot create slots; outsider cannot even view', async () => {
    await expect(createSlot(player, teamA, {
      seasonId, weekday: 4, startTime: '19:00', endTime: '20:00', locationId: hallId
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(listTeamSessions(outsider, teamA)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('staff of team A cannot create slots on team B', async () => {
    await expect(createSlot(coach, teamB, {
      seasonId, weekday: 4, startTime: '19:00', endTime: '20:00', locationId: hallId
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('trainer must be active staff of the team', async () => {
    await expect(createSlot(coach, teamA, {
      seasonId, weekday: 5, startTime: '19:00', endTime: '20:00',
      locationId: hallId, trainerUserId: outsider
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('end time before start time is a 400; unknown season/location are 404', async () => {
    await expect(createSlot(coach, teamA, {
      seasonId, weekday: 5, startTime: '20:00', endTime: '19:00', locationId: hallId
    })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createSlot(coach, teamA, {
      seasonId: 'nope', weekday: 5, startTime: '19:00', endTime: '20:00', locationId: hallId
    })).rejects.toMatchObject({ statusCode: 404 })
    await expect(createSlot(coach, teamA, {
      seasonId, weekday: 5, startTime: '19:00', endTime: '20:00', locationId: 'nope'
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('slot weekday change regenerates future sessions on the new weekday', async () => {
    const slots = await listSlots(coach, teamA)
    const { sessionsRegenerated } = await updateSlot(coach, slots[0]!.id, { weekday: 3, generateFrom: S })
    expect(sessionsRegenerated).toBeGreaterThan(8)
    const sessions = await listTeamSessions(coach, teamA, { from: S })
    const slotSessions = sessions.filter(s => s.slotId === slots[0]!.id)
    expect(slotSessions.every(s => isoWeekday(s.date) === 3)).toBe(true)
  })

  it('a location in use cannot be deleted (409)', async () => {
    await expect(deleteLocation(admin, hallId)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('F10 one-off sessions + edit/cancel', () => {
  it('staff creates a one-off session; it shows in the team schedule', async () => {
    const s = await createOneOffSession(coach, teamA, {
      date: `${Y}-02-06`, startTime: '10:00', endTime: '11:30', locationId: hallId
    })
    expect(s.slotId).toBeNull()
    const sessions = await listTeamSessions(player, teamA, { from: `${Y}-02-06` })
    expect(sessions.map(x => x.id)).toContain(s.id)
  })

  it('cancelling requires a reason; cancelled sessions stay visible with it', async () => {
    const s = await createOneOffSession(coach, teamA, {
      date: `${Y}-02-13`, startTime: '10:00', endTime: '11:00', locationId: hallId
    })
    await expect(updateSession(coach, s.id, { status: 'cancelled' }))
      .rejects.toMatchObject({ statusCode: 400 })
    const cancelled = await updateSession(coach, s.id, { status: 'cancelled', cancelReason: 'Trainer ziek' })
    expect(cancelled.status).toBe('cancelled')
    const visible = await listTeamSessions(player, teamA, { from: `${Y}-02-13` })
    const row = visible.find(x => x.id === s.id)!
    expect(row.status).toBe('cancelled')
    expect(row.cancelReason).toBe('Trainer ziek')
    // reinstate clears the reason
    const back = await updateSession(coach, s.id, { status: 'scheduled' })
    expect(back.cancelReason).toBeNull()
  })

  it('players cannot edit sessions', async () => {
    const sessions = await listTeamSessions(player, teamA, { from: S })
    await expect(updateSession(player, sessions[0]!.id, { startTime: '18:00', endTime: '19:00' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F10 no-training periods (two levels)', () => {
  it('team staff sets a team period; overlapping team sessions get cancelled with the reason', async () => {
    const before = await listTeamSessions(coach, teamA, { from: S })
    const target = before.find(s => s.status === 'scheduled')!
    const { cancelledSessions } = await createNoTrainingPeriod(coach, {
      teamId: teamA, startDate: target.date, endDate: target.date, reason: 'Toernooiweekend'
    })
    expect(cancelledSessions).toBeGreaterThanOrEqual(1)
    const after = await listTeamSessions(coach, teamA, { from: S })
    expect(after.find(s => s.id === target.id)!.status).toBe('cancelled')
    expect(after.find(s => s.id === target.id)!.cancelReason).toBe('Toernooiweekend')
  })

  it('non-admin cannot set a CLUB-level closure; staff cannot set a period for another team', async () => {
    await expect(createNoTrainingPeriod(coach, { startDate: S, endDate: S, reason: 'X' }))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(createNoTrainingPeriod(coach, { teamId: teamB, startDate: S, endDate: S, reason: 'X' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin club closure cancels sessions across ALL teams and blocks new ones', async () => {
    const closureDate = `${Y}-03-06`
    await createOneOffSession(coach, teamA, {
      date: closureDate, startTime: '10:00', endTime: '11:00', locationId: hallId
    })
    const { cancelledSessions } = await createNoTrainingPeriod(admin, {
      startDate: `${Y}-03-01`, endDate: `${Y}-03-07`, reason: 'Hal gesloten'
    })
    expect(cancelledSessions).toBeGreaterThanOrEqual(1)
    // one-off inside the closure -> 409, team cannot supersede the admin boundary
    await expect(createOneOffSession(coach, teamA, {
      date: closureDate, startTime: '12:00', endTime: '13:00', locationId: hallId
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('reinstating a session inside a club closure is a 409 (team never supersedes admin)', async () => {
    const sessions = await listTeamSessions(coach, teamA, { from: `${Y}-03-01` })
    const inClosure = sessions.find(s => s.date <= `${Y}-03-07` && s.status === 'cancelled')!
    await expect(updateSession(coach, inClosure.id, { status: 'scheduled' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('new slots skip closure dates at generation', async () => {
    const { slot, sessionsCreated } = await createSlot(coach, teamA, {
      seasonId, weekday: 6, startTime: '09:00', endTime: '10:00',
      locationId: hallId, generateFrom: S
    })
    const sessions = (await listTeamSessions(coach, teamA, { from: S }))
      .filter(s => s.slotId === slot.id)
    expect(sessions.length).toBe(sessionsCreated)
    expect(sessions.every(s => s.date < `${Y}-03-01` || s.date > `${Y}-03-07`)).toBe(true)
    await deleteSlot(coach, slot.id, S)
  })

  it('deleting a period does not auto-reinstate, but reinstate then works', async () => {
    const periods = await listNoTrainingPeriods(teamA)
    const teamPeriod = periods.find(p => p.teamId === teamA)!
    const cancelled = (await listTeamSessions(coach, teamA, { from: S }))
      .find(s => s.date === teamPeriod.startDate && s.status === 'cancelled')!
    await deleteNoTrainingPeriod(coach, teamPeriod.id)
    const still = (await listTeamSessions(coach, teamA, { from: S })).find(s => s.id === cancelled.id)!
    expect(still.status).toBe('cancelled')
    const back = await updateSession(coach, cancelled.id, { status: 'scheduled' })
    expect(back.status).toBe('scheduled')
  })

  it('slot deletion removes its future sessions but keeps the past intact', async () => {
    const slots = await listSlots(coach, teamA)
    const target = slots[0]!
    const before = (await listTeamSessions(coach, teamA, { from: S })).filter(s => s.slotId === target.id)
    expect(before.length).toBeGreaterThan(0)
    await deleteSlot(coach, target.id, S)
    const after = (await listTeamSessions(coach, teamA, { from: S })).filter(s => s.slotId === target.id)
    expect(after.length).toBe(0)
  })
})
