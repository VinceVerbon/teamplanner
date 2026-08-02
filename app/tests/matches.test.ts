// Test-set for F12 (matches) + F21 (Sportlink .ical import with preview).
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer } from '../server/services/members'
import { createSeason, createLocation, createNoTrainingPeriod } from '../server/services/schedule'
import { createSlot, listTeamSessions, updateSession, getMySchedule } from '../server/services/trainings'
import { createMatch, previewMatchImport, importMatches } from '../server/services/matches'
import { parseIcalEvents, deriveMatch } from '../server/utils/ical'
import { user } from '../server/db/schema'

let admin: string
let coach: string
let player: string
let teamA: string
let hallId: string

const Y = new Date().getFullYear() + 1

const SPORTLINK_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Sportlink//NONSGML v1.0//NL',
  'BEGIN:VEVENT',
  'UID:match-001@sportlink.nl',
  `DTSTART;TZID=Europe/Amsterdam:${Y}0905T143000`,
  `DTEND;TZID=Europe/Amsterdam:${Y}0905T160000`,
  'SUMMARY:FC Aalsmeer MO17-4 - RKDES MO17-3',
  'LOCATION:Sportpark Hornmeer\\, Aalsmeer',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:match-002@sportlink.nl',
  `DTSTART;TZID=Europe/Amsterdam:${Y}0912T113000`,
  `DTEND;TZID=Europe/Amsterdam:${Y}0912T130000`,
  'SUMMARY:Legmeervogels MO17-2 - FC Aalsmeer', // folded: next line = space marker + ' MO17-4'
  '  MO17-4',
  'LOCATION:Sportpark De Legmeer\\, Uithoorn',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-003@sportlink.nl',
  `DTSTART:${Y}0919`,
  'SUMMARY:Inhaalweekend',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

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
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  teamA = (await createTeam(admin, club.id, 'MO17-4')).id
  await addStaff(admin, teamA, 'coach@example.com')
  await assignPlayer(admin, teamA, 'player@example.com')
  hallId = (await createLocation(admin, { name: 'Sportpark Hornmeer' })).id
})

describe('F21 ical parsing (pure functions)', () => {
  it('parses VEVENTs with TZID datetimes, folded lines and escaped text', () => {
    const events = parseIcalEvents(SPORTLINK_ICAL)
    expect(events).toHaveLength(3)
    const [home, away, allday] = events
    expect(home!.uid).toBe('match-001@sportlink.nl')
    expect(home!.date).toBe(`${Y}-09-05`)
    expect(home!.startTime).toBe('14:30')
    expect(home!.endTime).toBe('16:00')
    expect(home!.location).toBe('Sportpark Hornmeer, Aalsmeer')
    // folded SUMMARY line is rejoined
    expect(away!.summary).toBe('Legmeervogels MO17-2 - FC Aalsmeer MO17-4')
    // all-day event has a date but no time
    expect(allday!.date).toBe(`${Y}-09-19`)
    expect(allday!.startTime).toBeNull()
  })

  it('derives opponent and home/away from the summary (home side first)', () => {
    const own = ['FC Aalsmeer', 'MO17-4']
    expect(deriveMatch('FC Aalsmeer MO17-4 - RKDES MO17-3', own))
      .toEqual({ opponent: 'RKDES MO17-3', homeAway: 'home' })
    expect(deriveMatch('Legmeervogels MO17-2 - FC Aalsmeer MO17-4', own))
      .toEqual({ opponent: 'Legmeervogels MO17-2', homeAway: 'away' })
    expect(deriveMatch('Geen wedstrijdformaat', own)).toBeNull()
  })
})

describe('F21 preview -> import', () => {
  it('preview parses both matches, skips the all-day row, writes nothing', async () => {
    const { rows, skipped } = await previewMatchImport(coach, teamA, SPORTLINK_ICAL)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.homeAway).toBe('home')
    expect(rows[1]!.homeAway).toBe('away')
    expect(rows.every(r => !r.alreadyImported)).toBe(true)
    expect(skipped).toHaveLength(1)
    const sessions = await listTeamSessions(coach, teamA, { from: `${Y}-09-01` })
    expect(sessions.filter(s => s.type === 'match')).toHaveLength(0)
  })

  it('players cannot preview or import', async () => {
    await expect(previewMatchImport(player, teamA, SPORTLINK_ICAL))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(importMatches(player, teamA, [])).rejects.toMatchObject({ statusCode: 403 })
  })

  it('import loads the previewed rows as matches with free-text locations', async () => {
    const { rows } = await previewMatchImport(coach, teamA, SPORTLINK_ICAL)
    const { imported, skipped } = await importMatches(coach, teamA, rows)
    expect(imported).toBe(2)
    expect(skipped).toBe(0)
    const sessions = await listTeamSessions(player, teamA, { from: `${Y}-09-01` })
    const matches = sessions.filter(s => s.type === 'match')
    expect(matches).toHaveLength(2)
    expect(matches[0]!.opponent).toBe('RKDES MO17-3')
    expect(matches[0]!.locationName).toBe('Sportpark Hornmeer, Aalsmeer')
  })

  it('re-import is safe: same UIDs are skipped, preview flags them', async () => {
    const { rows } = await previewMatchImport(coach, teamA, SPORTLINK_ICAL)
    expect(rows.every(r => r.alreadyImported)).toBe(true)
    const { imported, skipped } = await importMatches(coach, teamA, rows)
    expect(imported).toBe(0)
    expect(skipped).toBe(2)
  })

  it('UID-less duplicates on date+time+opponent are also skipped', async () => {
    const { imported, skipped } = await importMatches(coach, teamA, [{
      externalUid: null,
      date: `${Y}-09-05`,
      startTime: '14:30',
      endTime: '16:00',
      opponent: 'RKDES MO17-3',
      homeAway: 'home',
      locationText: 'elders'
    }])
    expect(imported).toBe(0)
    expect(skipped).toBe(1)
  })
})

describe('F12 matches on the shared machinery', () => {
  it('staff creates a manual match; end time defaults to start + 2h', async () => {
    const match = await createMatch(coach, teamA, {
      date: `${Y}-09-26`, startTime: '10:00', opponent: 'Buitenveldert MO17-1',
      homeAway: 'home', locationId: hallId
    })
    expect(match.type).toBe('match')
    expect(match.endTime).toBe('12:00')
  })

  it('a match without any location is a 400; players cannot create matches', async () => {
    await expect(createMatch(coach, teamA, {
      date: `${Y}-10-03`, startTime: '10:00', opponent: 'X', homeAway: 'home'
    })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createMatch(player, teamA, {
      date: `${Y}-10-03`, startTime: '10:00', opponent: 'RKDES', homeAway: 'home', locationText: 'daar'
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('matches appear in the member schedule with opponent info', async () => {
    const schedule = await getMySchedule(player, { from: `${Y}-09-01` })
    const matches = schedule.find(e => e.team.id === teamA)!.sessions.filter(s => s.type === 'match')
    expect(matches.length).toBeGreaterThanOrEqual(3)
    expect(matches.some(m => m.opponent === 'RKDES MO17-3')).toBe(true)
  })

  it('no-training periods do NOT cancel or block matches, but DO cancel trainings', async () => {
    const seasonId = (await createSeason(admin, { name: `S${Y}`, startDate: `${Y}-09-01`, endDate: `${Y}-10-31` })).id
    await createSlot(coach, teamA, {
      seasonId, weekday: 5, startTime: '19:00', endTime: '20:00',
      locationId: hallId, generateFrom: `${Y}-09-01`
    })
    const { cancelledSessions } = await createNoTrainingPeriod(admin, {
      startDate: `${Y}-09-01`, endDate: `${Y}-09-30`, reason: 'Velden dicht'
    })
    expect(cancelledSessions).toBeGreaterThan(0)
    const sessions = await listTeamSessions(coach, teamA, { from: `${Y}-09-01` })
    const septMatches = sessions.filter(s => s.type === 'match' && s.date <= `${Y}-09-30`)
    expect(septMatches.length).toBeGreaterThanOrEqual(3)
    expect(septMatches.every(m => m.status === 'scheduled')).toBe(true)
    const septTrainings = sessions.filter(s => s.type === 'training' && s.date <= `${Y}-09-30`)
    expect(septTrainings.every(t => t.status === 'cancelled')).toBe(true)
  })

  it('a cancelled match can be reinstated inside a closure (matches are exempt)', async () => {
    const sessions = await listTeamSessions(coach, teamA, { from: `${Y}-09-01` })
    const match = sessions.find(s => s.type === 'match' && s.date === `${Y}-09-05`)!
    await updateSession(coach, match.id, { status: 'cancelled', cancelReason: 'Afgelast door KNVB' })
    const back = await updateSession(coach, match.id, { status: 'scheduled' })
    expect(back.status).toBe('scheduled')
  })
})
