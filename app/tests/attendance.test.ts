// Test-set for F13 (opt-out absence tracking) + F15 (transparent attendance stats).
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer, listTeamMembers } from '../server/services/members'
import { createLocation } from '../server/services/schedule'
import { createOneOffSession, listTeamSessions, getMySchedule } from '../server/services/trainings'
import { requestParentLink, confirmParentLink } from '../server/services/parents'
import {
  reportAbsence, withdrawAbsence, recordNoShow, attendanceStats
} from '../server/services/attendance'
import { classifyAbsence } from '../server/utils/absence-rules'
import { user, trainingSessions } from '../server/db/schema'

let admin: string
let coach: string
let teen16: string // player, manages own attendance
let kid14: string // player, parent manages
let parent1: string // parent of kid14
let outsider: string
let clubId: string
let teamA: string
let hallId: string
let futureSession: string // tomorrow-ish, scheduled

const Y = new Date().getFullYear() + 1

function dobYearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

async function makeUser(email: string, dob?: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: dob ?? '1990-01-01' }).returning()
  return u!.id
}

async function insertPastTraining(date: string, status: 'scheduled' | 'cancelled' = 'scheduled', type: 'training' | 'match' = 'training'): Promise<string> {
  const [s] = await getDb().insert(trainingSessions).values({
    clubId, teamId: teamA, type, date, startTime: '19:00', endTime: '20:00',
    locationId: hallId, status, cancelReason: status === 'cancelled' ? 'x' : null
  }).returning()
  return s!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  coach = await makeUser('coach@example.com')
  teen16 = await makeUser('teen16@example.com', dobYearsAgo(16))
  kid14 = await makeUser('kid14@example.com', dobYearsAgo(14))
  parent1 = await makeUser('parent1@example.com', dobYearsAgo(45))
  outsider = await makeUser('outsider@example.com')
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  teamA = (await createTeam(admin, clubId, 'MO17-4')).id
  await addStaff(admin, teamA, 'coach@example.com')
  await assignPlayer(admin, teamA, 'teen16@example.com')
  await assignPlayer(admin, teamA, 'kid14@example.com')
  const link = await requestParentLink(kid14, 'parent1@example.com', 'parent')
  await confirmParentLink(parent1, link.token)
  hallId = (await createLocation(admin, { name: 'Hal 1' })).id
  futureSession = (await createOneOffSession(coach, teamA, {
    date: `${Y}-05-12`, startTime: '19:00', endTime: '20:30', locationId: hallId
  })).id
})

describe('F13 classification (pure functions)', () => {
  const d = '2027-03-10'
  const t = '19:00'
  it('>= 1.5h before start is timely, boundary inclusive', () => {
    expect(classifyAbsence(d, t, new Date('2027-03-10T17:30:00'))).toBe('timely')
    expect(classifyAbsence(d, t, new Date('2027-03-09T12:00:00'))).toBe('timely')
  })
  it('between 1.5h and start is late', () => {
    expect(classifyAbsence(d, t, new Date('2027-03-10T17:31:00'))).toBe('late')
    expect(classifyAbsence(d, t, new Date('2027-03-10T18:59:00'))).toBe('late')
  })
  it('at or after start is a no-show', () => {
    expect(classifyAbsence(d, t, new Date('2027-03-10T19:00:00'))).toBe('no-show')
    expect(classifyAbsence(d, t, new Date('2027-03-10T21:00:00'))).toBe('no-show')
  })
})

describe('F13 reporting per the F5 age rules', () => {
  it('a 16-year-old reports their own absence; timely classification stored', async () => {
    const absence = await reportAbsence(teen16, futureSession, teen16, {
      reason: 'toets morgen', at: new Date(`${Y}-05-12T10:00:00`)
    })
    expect(absence.classification).toBe('timely')
    expect(absence.source).toBe('reported')
  })

  it('duplicate report for the same session is a 409', async () => {
    await expect(reportAbsence(teen16, futureSession, teen16))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('an under-15 cannot self-report; their linked parent can (late timing -> late)', async () => {
    await expect(reportAbsence(kid14, futureSession, kid14))
      .rejects.toMatchObject({ statusCode: 403 })
    const absence = await reportAbsence(parent1, futureSession, kid14, {
      at: new Date(`${Y}-05-12T18:30:00`)
    })
    expect(absence.classification).toBe('late')
    expect(absence.reportedByUserId).toBe(parent1)
  })

  it('an outsider (no link, no role) cannot report for a player', async () => {
    const s = await createOneOffSession(coach, teamA, {
      date: `${Y}-05-19`, startTime: '19:00', endTime: '20:00', locationId: hallId
    })
    await expect(reportAbsence(outsider, s.id, teen16)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reporting for a cancelled session or a non-team player fails', async () => {
    const s = await createOneOffSession(coach, teamA, {
      date: `${Y}-05-26`, startTime: '19:00', endTime: '20:00', locationId: hallId
    })
    const { updateSession } = await import('../server/services/trainings')
    await updateSession(coach, s.id, { status: 'cancelled', cancelReason: 'test' })
    await expect(reportAbsence(teen16, s.id, teen16)).rejects.toMatchObject({ statusCode: 409 })
    await expect(reportAbsence(outsider, futureSession, outsider))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('withdraw before start by the reporter works; after start it is a 409 (staff can still remove)', async () => {
    const s = await createOneOffSession(coach, teamA, {
      date: `${Y}-06-02`, startTime: '19:00', endTime: '20:00', locationId: hallId
    })
    const a1 = await reportAbsence(teen16, s.id, teen16, { at: new Date(`${Y}-06-01T10:00:00`) })
    const res = await withdrawAbsence(teen16, a1.id, { at: new Date(`${Y}-06-01T12:00:00`) })
    expect(res.removed).toBe(true)
    const a2 = await reportAbsence(teen16, s.id, teen16, { at: new Date(`${Y}-06-01T10:00:00`) })
    await expect(withdrawAbsence(teen16, a2.id, { at: new Date(`${Y}-06-02T19:30:00`) }))
      .rejects.toMatchObject({ statusCode: 409 })
    expect((await withdrawAbsence(coach, a2.id)).removed).toBe(true)
  })
})

describe('F13 staff corrections (no-shows)', () => {
  it('staff records a no-show after the session; before start is a 409', async () => {
    const past = await insertPastTraining('2020-01-06')
    const noShow = await recordNoShow(coach, past, teen16)
    expect(noShow.classification).toBe('no-show')
    expect(noShow.source).toBe('staff')
    await expect(recordNoShow(coach, futureSession, kid14, { at: new Date() }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('players cannot record no-shows', async () => {
    const past = await insertPastTraining('2020-01-13')
    await expect(recordNoShow(teen16, past, kid14)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F13/F15 transparency', () => {
  it('absences are visible on the team schedule to players and parents', async () => {
    const sessions = await listTeamSessions(kid14, teamA, { from: `${Y}-05-01` })
    const withAbsences = sessions.find(s => s.id === futureSession)!
    expect(withAbsences.absences.map(a => a.playerName).sort()).toEqual(['kid14', 'teen16'])
    const parentView = await getMySchedule(parent1, { from: `${Y}-05-01` })
    const entry = parentView.find(e => e.team.id === teamA)!
    expect(entry.sessions.find(s => s.id === futureSession)!.absences).toHaveLength(2)
  })

  it('getMySchedule exposes who the user may report for (self / kids per age rules)', async () => {
    const teenView = await getMySchedule(teen16, { from: `${Y}-05-01` })
    expect(teenView.find(e => e.team.id === teamA)!.manageablePlayers.map(p => p.userId))
      .toEqual([teen16])
    const parentView = await getMySchedule(parent1, { from: `${Y}-05-01` })
    expect(parentView.find(e => e.team.id === teamA)!.manageablePlayers.map(p => p.userId))
      .toEqual([kid14])
    const kidView = await getMySchedule(kid14, { from: `${Y}-05-01` })
    expect(kidView.find(e => e.team.id === teamA)!.manageablePlayers).toEqual([])
  })

  it('parents can also view the roster (listTeamMembers)', async () => {
    const { players } = await listTeamMembers(parent1, teamA)
    expect(players.map(p => p.userId)).toContain(kid14)
    await expect(listTeamMembers(outsider, teamA)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F15 attendance stats', () => {
  it('computes per-player percentages over past scheduled trainings only', async () => {
    // 2 more past trainings (3 total from 2020-01-06/13 + this) + noise that must not count
    const past3 = await insertPastTraining('2020-01-20')
    await insertPastTraining('2020-01-27', 'cancelled') // cancelled -> excluded
    await insertPastTraining('2020-02-03', 'scheduled', 'match') // match -> excluded
    await recordNoShow(coach, past3, kid14)
    const stats = await attendanceStats(coach, teamA, { until: '2020-03-01' })
    expect(stats.totalTrainings).toBe(3)
    const teenRow = stats.players.find(p => p.userId === teen16)!
    expect(teenRow.absent).toBe(1) // the 2020-01-06 no-show
    expect(teenRow.percentage).toBe(67)
    const kidRow = stats.players.find(p => p.userId === kid14)!
    expect(kidRow.counts.noShow).toBe(1)
    expect(kidRow.percentage).toBe(67)
  })

  it('stats are visible to players and parents, not to outsiders', async () => {
    const forPlayer = await attendanceStats(teen16, teamA, { until: '2020-03-01' })
    expect(forPlayer.totalTrainings).toBe(3)
    const forParent = await attendanceStats(parent1, teamA, { until: '2020-03-01' })
    expect(forParent.players.length).toBeGreaterThan(0)
    await expect(attendanceStats(outsider, teamA)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('a team without past trainings reports null percentages', async () => {
    const teamB = (await createTeam(admin, clubId, 'MO15-2')).id
    const stats = await attendanceStats(admin, teamB)
    expect(stats.totalTrainings).toBe(0)
    expect(stats.players).toEqual([])
  })
})
