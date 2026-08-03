// Test-set for F29 (speeldagenkalender -> schedule) - main flows and expected edge
// cases, plus the bundled week-number util (F26 leftover). Kalender data is seeded
// directly via storeKalender (no PDFs needed).
import { describe, it, expect, beforeAll } from 'vitest'
import { eq, and, like } from 'drizzle-orm'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub, updateClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer } from '../server/services/members'
import { storeKalender, setTeamKalender, getTeamKalenderOptions } from '../server/services/speeldagen'
import {
  classifyKalenderCell, listKalenderWeekends, importKalenderWeekends
} from '../server/services/kalender-schedule'
import { listTeamSessions } from '../server/services/trainings'
import { importMatches } from '../server/services/matches'
import { weekNumber } from '../shared/utils/week-number'
import { user, trainingSessions } from '../server/db/schema'

// Keep all kalender dates in the future: sessions listings default to from=today.
const Y = new Date().getFullYear() + 1

let admin: string
let coach: string
let player: string
let clubId: string
let teamId: string
let bareTeamId: string
let columnId: string

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
  clubId = club.id
  await updateClub(admin, clubId, { region: 'west' })
  teamId = (await createTeam(admin, clubId, 'MO17-4')).id
  bareTeamId = (await createTeam(admin, clubId, 'MO15-2')).id
  await addStaff(admin, teamId, 'coach@example.com')
  await assignPlayer(admin, teamId, 'player@example.com')
  // Two columns so we prove only the TEAM's column is consumed.
  await storeKalender({
    title: 'Speeldagenkalender West',
    columns: ['Meiden Cat A', 'Toernooien'],
    days: [
      { label: `5 / 6 sept. ${Y}`, dateStart: `${Y}-09-05`, dateEnd: `${Y}-09-06`, cells: ['WD', '18/09'], remark: null },
      { label: `12 / 13 sept. ${Y}`, dateStart: `${Y}-09-12`, dateEnd: `${Y}-09-13`, cells: ['Vrij', null], remark: 'Herfstvak. alle regio\'s' },
      { label: `19 / 20 sept. ${Y}`, dateStart: `${Y}-09-19`, dateEnd: `${Y}-09-20`, cells: ['Inh. / Bek.', null], remark: null },
      { label: `zat. 26 sept. ${Y}`, dateStart: `${Y}-09-26`, dateEnd: null, cells: ['Fase 2', 'Beker'], remark: 'Paaszaterdag' },
      { label: `3 / 4 okt. ${Y}`, dateStart: `${Y}-10-03`, dateEnd: `${Y}-10-04`, cells: ['NC', null], remark: null },
      { label: `10 / 11 okt. ${Y}`, dateStart: `${Y}-10-10`, dateEnd: `${Y}-10-11`, cells: ['Inhaal', null], remark: null },
      { label: `17 / 18 okt. ${Y}`, dateStart: `${Y}-10-17`, dateEnd: `${Y}-10-18`, cells: ['3', null], remark: null }
    ]
  }, 'west', `${Y}/'${String(Y + 1).slice(2)}`, 'https://example/test.pdf', 'active')
  const options = await getTeamKalenderOptions(admin, teamId)
  columnId = options.options.find(o => o.title === 'Meiden Cat A')!.columnId
  await setTeamKalender(admin, teamId, columnId)
})

describe('F29 kalender cell classification', () => {
  it('classifies the observed KNVB vocabulary', () => {
    for (const v of ['WD', 'WD NJ', 'WD (zat)', 'Fase 3', 'Start Fase 1', 'Week 4', 'Beker poule', '12', 'Final League', 'Finale Div 1', 'Q1/Q2 Beker BV', 'Jeugdcup KF', 'Div Fase 2 - Hfdkl F3', 'Hfdkl F3', 'Midweekse Bekerronde']) {
      expect(classifyKalenderCell(v), v).toBe(v.includes('/') ? 'reserve' : 'speeldag')
    }
    for (const v of ['Vrij', 'vrij', 'NC', '-', '', '  ']) {
      expect(classifyKalenderCell(v), v).toBe('vrij')
    }
    expect(classifyKalenderCell(null)).toBe('vrij')
    for (const v of ['Inhaal', 'Inh. / Bek.', 'Vrij / Bek.', 'WD NJ (M) / Inh.', 'Uitwijk', 'Inh. /', 'iets onbekends']) {
      expect(classifyKalenderCell(v), v).toBe('reserve')
    }
  })
})

describe('F29 kalender -> schedule - main flows', () => {
  it('lists the non-vrij days of the TEAM column in kalender order with classification', async () => {
    const list = await listKalenderWeekends(admin, teamId)
    expect(list.map(w => [w.date, w.value, w.classification])).toEqual([
      [`${Y}-09-05`, 'WD', 'speeldag'],
      [`${Y}-09-19`, 'Inh. / Bek.', 'reserve'],
      [`${Y}-09-26`, 'Fase 2', 'speeldag'],
      [`${Y}-10-10`, 'Inhaal', 'reserve'],
      [`${Y}-10-17`, '3', 'speeldag']
    ])
    expect(list.every(w => !w.alreadyImported)).toBe(true)
    // remark and label ride along for the preview UI
    expect(list.find(w => w.date === `${Y}-09-26`)?.remark).toBe('Paaszaterdag')
  })

  it('active team staff may list too (same rights as match planning)', async () => {
    const list = await listKalenderWeekends(coach, teamId)
    expect(list.length).toBe(5)
  })

  it('imports selected days as placeholder matches on the weekend FIRST day', async () => {
    const res = await importKalenderWeekends(admin, teamId, {
      dates: [`${Y}-09-05`, `${Y}-09-26`], startTime: '14:30'
    })
    expect(res).toEqual({ imported: 2, skipped: 0 })
    const db = getDb()
    const rows = await db.select().from(trainingSessions)
      .where(and(eq(trainingSessions.teamId, teamId), like(trainingSessions.externalUid, 'kalender:%')))
    expect(rows.length).toBe(2)
    const wd = rows.find(r => r.date === `${Y}-09-05`)!
    expect(wd.type).toBe('match')
    expect(wd.opponent).toBe('Speeldag WD')
    expect(wd.homeAway).toBeNull()
    expect(wd.locationText).toBe('n.t.b.')
    expect(wd.startTime).toBe('14:30')
    expect(wd.endTime).toBe('16:30') // +2h default
    expect(wd.externalUid).toBe(`kalender:${Y}-09-05`)
  })

  it('re-import is idempotent and the list flags imported days', async () => {
    const res = await importKalenderWeekends(admin, teamId, {
      dates: [`${Y}-09-05`, `${Y}-10-10`], startTime: '14:30'
    })
    expect(res).toEqual({ imported: 1, skipped: 1 })
    const list = await listKalenderWeekends(admin, teamId)
    expect(list.filter(w => w.alreadyImported).map(w => w.date))
      .toEqual([`${Y}-09-05`, `${Y}-09-26`, `${Y}-10-10`])
  })

  it('placeholders appear in the team sessions listing', async () => {
    const sessions = await listTeamSessions(admin, teamId, { from: `${Y}-09-01` })
    const placeholder = sessions.find(s => s.date === `${Y}-09-05`)
    expect(placeholder?.type).toBe('match')
    expect(placeholder?.opponent).toBe('Speeldag WD')
  })

  it('a later real Sportlink import on the same date coexists (different natural key)', async () => {
    const res = await importMatches(admin, teamId, [{
      externalUid: 'sportlink-123',
      date: `${Y}-09-05`,
      startTime: '14:30',
      endTime: '16:30',
      opponent: 'RKDES MO17-3',
      homeAway: 'away',
      locationText: 'Sportpark RKDES'
    }])
    expect(res).toEqual({ imported: 1, skipped: 0 })
  })
})

describe('F29 kalender -> schedule - edge cases', () => {
  it('team without a kalender category is a 409 on list and import', async () => {
    await expect(listKalenderWeekends(admin, bareTeamId)).rejects.toMatchObject({ statusCode: 409 })
    await expect(importKalenderWeekends(admin, bareTeamId, { dates: [`${Y}-09-05`], startTime: '14:30' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('players cannot list or import (manager rights required)', async () => {
    await expect(listKalenderWeekends(player, teamId)).rejects.toMatchObject({ statusCode: 403 })
    await expect(importKalenderWeekends(player, teamId, { dates: [`${Y}-10-17`], startTime: '14:30' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('importing a date that is not a speeldag/reserve day is a 400 (incl. vrij days)', async () => {
    await expect(importKalenderWeekends(admin, teamId, { dates: [`${Y}-09-12`], startTime: '14:30' }))
      .rejects.toMatchObject({ statusCode: 400 }) // Vrij
    await expect(importKalenderWeekends(admin, teamId, { dates: [`${Y}-12-25`], startTime: '14:30' }))
      .rejects.toMatchObject({ statusCode: 400 }) // not on the kalender at all
  })

  it('an explicit end time is honored; an end before start is a 400', async () => {
    const res = await importKalenderWeekends(coach, teamId, {
      dates: [`${Y}-10-17`], startTime: '10:00', endTime: '11:15'
    })
    expect(res.imported).toBe(1)
    const db = getDb()
    const [row] = await db.select().from(trainingSessions)
      .where(and(eq(trainingSessions.teamId, teamId), eq(trainingSessions.externalUid, `kalender:${Y}-10-17`)))
    expect(row?.endTime).toBe('11:15')
    await expect(importKalenderWeekends(admin, teamId, { dates: [`${Y}-09-19`], startTime: '14:00', endTime: '13:00' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('unknown team is a 404', async () => {
    await expect(listKalenderWeekends(admin, 'no-such-team')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('F29/F26 week numbers - main flows and boundaries', () => {
  it('ISO: weeks start Monday, week 1 holds the first Thursday', () => {
    expect(weekNumber('2026-01-01', 'iso')).toBe(1) // Thursday
    expect(weekNumber('2026-01-04', 'iso')).toBe(1) // Sunday closes week 1
    expect(weekNumber('2026-01-05', 'iso')).toBe(2) // Monday opens week 2
    expect(weekNumber('2024-12-30', 'iso')).toBe(1) // Monday already in ISO-2025 week 1
    expect(weekNumber('2027-01-01', 'iso')).toBe(53) // Friday still in ISO-2026 week 53
  })

  it('US: weeks start Sunday, week 1 holds Jan 1', () => {
    expect(weekNumber('2026-01-01', 'us')).toBe(1) // Thursday
    expect(weekNumber('2026-01-03', 'us')).toBe(1) // Saturday closes week 1
    expect(weekNumber('2026-01-04', 'us')).toBe(2) // Sunday opens week 2
    expect(weekNumber('2026-12-31', 'us')).toBe(53)
  })

  it('the two schemes disagree exactly where they should', () => {
    // Sunday: same day, different week under US (opens a week) vs ISO (closes one).
    expect(weekNumber('2026-01-04', 'iso')).not.toBe(weekNumber('2026-01-04', 'us'))
    // A mid-year Wednesday lands in the same week under both schemes in 2026.
    expect(weekNumber('2026-07-01', 'iso')).toBe(27)
    expect(weekNumber('2026-07-01', 'us')).toBe(27)
  })
})
