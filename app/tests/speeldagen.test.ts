// Test-set for the F28 lifecycle: central fetch (fixture-fed), pending -> activate,
// diff -> process/cancel, central changelog, force reload, and the club-region /
// team-category selection model. Also the DB-vs-PDF date verification.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { user, teams as teamsTable, speeldagKalenderDays, speeldagKalenders } from '../server/db/schema'
import { parseKalenderItems, type ParsedKalender } from '../server/utils/knvb-kalender'
import { extractPdfTextItems } from '../server/utils/knvb-pdf'
import {
  KNVB_SOURCES, fetchKalenders, activateKalender, discardPendingKalender,
  forceReloadKalenders, listKalenders, listKalenderChanges, getKalenderGrid,
  getPendingDiff, getTeamKalenderOptions, setTeamKalender, type PdfLoader
} from '../server/services/speeldagen'
import { createClub, updateClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'

const FIXTURES = join(__dirname, 'fixtures', 'knvb')

// Fixture-fed loader: serves the committed KNVB PDFs instead of the network.
const fixtureLoader: PdfLoader = async (url) => {
  const source = KNVB_SOURCES.find(s => s.url === url)!
  return new Uint8Array(readFileSync(join(FIXTURES, `${source.region}.pdf`)))
}

async function parseFixture(name: string): Promise<ParsedKalender> {
  const data = new Uint8Array(readFileSync(join(FIXTURES, `${name}.pdf`)))
  return parseKalenderItems((await extractPdfTextItems(data))[0]!)
}

let sysAdmin: string
let member: string
let clubId: string
let teamId: string

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user).values({ name: email.split('@')[0]!, email }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  sysAdmin = await makeUser('sys@example.com')
  member = await makeUser('member@example.com')
  await makeInstanceAdmin(sysAdmin)
  clubId = (await createClub(sysAdmin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })).id
  teamId = (await createTeam(sysAdmin, clubId, 'MO17-4')).id
})

describe('F28 fetch + activate lifecycle', () => {
  it('non-instance-admins cannot fetch (edge)', async () => {
    await expect(fetchKalenders(member, fixtureLoader))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('first fetch stores all six kalenders as pending', async () => {
    const results = await fetchKalenders(sysAdmin, fixtureLoader)
    expect(results).toHaveLength(6)
    expect(results.every(r => r.status === 'pending-new')).toBe(true)
    const list = await listKalenders()
    expect(list.filter(k => k.status === 'pending')).toHaveLength(6)
    expect(list.filter(k => k.status === 'active')).toHaveLength(0)
  })

  it('dates in the DB match the dates in the PDF (F28 verification)', async () => {
    const list = await listKalenders()
    const westPending = list.find(k => k.region === 'west')!
    const db = getDb()
    const dbDays = await db.select().from(speeldagKalenderDays)
      .where(eq(speeldagKalenderDays.kalenderId, westPending.id))
      .orderBy(speeldagKalenderDays.position)
    const pdf = await parseFixture('west')
    expect(dbDays.map(d => d.dateStart)).toEqual(pdf.days.map(d => d.dateStart))
    expect(dbDays.map(d => d.label)).toEqual(pdf.days.map(d => d.label))
  })

  it('activating a pending kalender (no predecessor) logs one changelog entry', async () => {
    const list = await listKalenders()
    for (const k of list.filter(k => k.status === 'pending')) {
      const result = await activateKalender(sysAdmin, k.id)
      expect(result.activated).toBe(true)
    }
    const after = await listKalenders()
    expect(after.filter(k => k.status === 'active')).toHaveLength(6)
    expect(after.filter(k => k.status === 'pending')).toHaveLength(0)
    const log = await listKalenderChanges()
    expect(log.filter(c => c.kind === 'kalender-activated')).toHaveLength(6)
  })

  it('re-fetch with identical content reports no changes and stores nothing', async () => {
    const results = await fetchKalenders(sysAdmin, fixtureLoader)
    expect(results.every(r => r.status === 'no-changes')).toBe(true)
    expect((await listKalenders()).filter(k => k.status === 'pending')).toHaveLength(0)
  })
})

describe('F28 change detection + processing', () => {
  async function mutateActiveWest() {
    // Simulate the KNVB revising the published kalender: change one cell in the DB
    // copy, then re-fetch the (unchanged) fixture - the diff runs the other way.
    const db = getDb()
    const [west] = await db.select().from(speeldagKalenders).where(eq(speeldagKalenders.region, 'west'))
    const grid = await getKalenderGrid(west!.id)
    const day = grid.days.find(d => d.label === '19 / 20 sept. 2026')!
    const { speeldagKalenderCells, speeldagKalenderColumns, speeldagKalenderDays: daysTable } = await import('../server/db/schema')
    const [col] = await db.select().from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, west!.id)).limit(1)
    const dayRows = await db.select().from(daysTable).where(eq(daysTable.kalenderId, west!.id))
    const dayRow = dayRows.find(d => d.label === day.label)!
    const { and: andOp } = await import('drizzle-orm')
    await db.update(speeldagKalenderCells).set({ value: 'Aangepast' })
      .where(andOp(
        eq(speeldagKalenderCells.dayId, dayRow.id),
        eq(speeldagKalenderCells.columnId, col!.id)
      ))
    return { westId: west!.id, colTitle: col!.title, dayLabel: day.label }
  }

  it('fetch after a change presents the diff as pending', async () => {
    await mutateActiveWest()
    const results = await fetchKalenders(sysAdmin, fixtureLoader)
    const west = results.find(r => r.region === 'west')!
    expect(west.status).toBe('changes-pending')
    expect(west.changes!.length).toBeGreaterThan(0)
    expect(west.changes!.every(c => c.kind === 'cell-changed')).toBe(true)
    // other regions unchanged
    expect(results.filter(r => r.status === 'no-changes')).toHaveLength(5)
    // diff endpoint reproduces it
    const diff = await getPendingDiff(sysAdmin, west.kalenderId!)
    expect(diff.length).toBe(west.changes!.length)
  })

  it('cancel discards the pending changes and keeps the active kalender (edge)', async () => {
    const pending = (await listKalenders()).find(k => k.status === 'pending' && k.region === 'west')!
    await discardPendingKalender(sysAdmin, pending.id)
    expect((await listKalenders()).filter(k => k.status === 'pending')).toHaveLength(0)
    // active still carries the mutated cell
    const active = (await listKalenders()).find(k => k.region === 'west' && k.status === 'active')!
    const grid = await getKalenderGrid(active.id)
    expect(grid.days.find(d => d.label === '19 / 20 sept. 2026')!.cells).toContain('Aangepast')
  })

  it('processing pending changes applies them and logs the EXACT changes centrally', async () => {
    const results = await fetchKalenders(sysAdmin, fixtureLoader)
    const west = results.find(r => r.region === 'west')!
    expect(west.status).toBe('changes-pending')
    const logBefore = (await listKalenderChanges()).length
    const result = await activateKalender(sysAdmin, west.kalenderId!)
    expect(result.processedChanges).toBe(west.changes!.length)
    const log = await listKalenderChanges()
    expect(log.length).toBe(logBefore + west.changes!.length)
    const entry = log.find(c => c.kind === 'cell-changed' && c.description.includes('19 / 20 sept. 2026'))
    expect(entry).toBeDefined()
    expect(entry!.description).toContain('\'Aangepast\' -> \'WD\'')
    expect(entry!.region).toBe('west')
    // active content is renewed
    const active = (await listKalenders()).find(k => k.region === 'west' && k.status === 'active')!
    const grid = await getKalenderGrid(active.id)
    expect(grid.days.find(d => d.label === '19 / 20 sept. 2026')!.cells[0]).toBe('WD')
  })
})

describe('F28 club region + team category selection', () => {
  it('no options before the club sets its region (edge)', async () => {
    const options = await getTeamKalenderOptions(sysAdmin, teamId)
    expect(options.options).toHaveLength(0)
  })

  it('club region unlocks that region\'s columns; national flag adds the landelijke kalenders', async () => {
    await updateClub(sysAdmin, clubId, { region: 'west' })
    let result = await getTeamKalenderOptions(sysAdmin, teamId)
    expect(result.options.length).toBe(13) // west columns
    expect(result.options.every(o => o.region === 'west')).toBe(true)
    await updateClub(sysAdmin, clubId, { hasNationalTeams: true })
    result = await getTeamKalenderOptions(sysAdmin, teamId)
    const regions = new Set(result.options.map(o => o.region))
    expect(regions.has('west')).toBe(true)
    expect(regions.has('landelijk')).toBe(true)
    expect(regions.has('landelijk-jeugd')).toBe(true)
  })

  it('team selects a category; the choice survives processed changes via title remap', async () => {
    const { options } = await getTeamKalenderOptions(sysAdmin, teamId)
    const meiden = options.find(o => o.region === 'west' && /Meiden/i.test(o.title))!
    await setTeamKalender(sysAdmin, teamId, meiden.columnId)
    // process a new fetch cycle (mutate active -> fetch -> process)
    const db = getDb()
    const { speeldagKalenderCells } = await import('../server/db/schema')
    const active = (await listKalenders()).find(k => k.region === 'west' && k.status === 'active')!
    const [anyCell] = await db.select().from(speeldagKalenderCells)
      .where(eq(speeldagKalenderCells.kalenderId, active.id)).limit(1)
    await db.update(speeldagKalenderCells).set({ value: 'Tijdelijk' }).where(eq(speeldagKalenderCells.id, anyCell!.id))
    const results = await fetchKalenders(sysAdmin, fixtureLoader)
    const west = results.find(r => r.region === 'west')!
    await activateKalender(sysAdmin, west.kalenderId!)
    // the team still points at the SAME category (new column id, same title)
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId))
    expect(team!.kalenderColumnId).toBeTruthy()
    const after = await getTeamKalenderOptions(sysAdmin, teamId)
    const selected = after.options.find(o => o.columnId === team!.kalenderColumnId)
    expect(selected).toBeDefined()
    expect(selected!.title).toBe(meiden.title)
  })

  it('a column outside the allowed regions is rejected (edge)', async () => {
    await updateClub(sysAdmin, clubId, { hasNationalTeams: false })
    const db = getDb()
    const { speeldagKalenderColumns } = await import('../server/db/schema')
    const landelijk = (await listKalenders()).find(k => k.region === 'landelijk' && k.status === 'active')!
    const [col] = await db.select().from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, landelijk.id)).limit(1)
    await expect(setTeamKalender(sysAdmin, teamId, col!.id))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('non-admins cannot set the team kalender (edge)', async () => {
    await expect(setTeamKalender(member, teamId, null))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F28 force reload', () => {
  it('dumps and renews everything, logs it, and remaps team selections (edge)', async () => {
    const db = getDb()
    const [before] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId))
    const beforeTitle = (await getTeamKalenderOptions(sysAdmin, teamId)).options
      .find(o => o.columnId === before!.kalenderColumnId)?.title
    const results = await forceReloadKalenders(sysAdmin, fixtureLoader)
    expect(results.filter(r => r.status === 'error')).toHaveLength(0)
    const list = await listKalenders()
    expect(list.filter(k => k.status === 'active')).toHaveLength(6)
    expect(list.filter(k => k.status === 'pending')).toHaveLength(0)
    const log = await listKalenderChanges()
    expect(log.filter(c => c.kind === 'kalender-force-reloaded')).toHaveLength(6)
    const [after] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId))
    expect(after!.kalenderColumnId).toBeTruthy()
    const afterTitle = (await getTeamKalenderOptions(sysAdmin, teamId)).options
      .find(o => o.columnId === after!.kalenderColumnId)?.title
    expect(afterTitle).toBe(beforeTitle)
  })

  it('non-instance-admins cannot force reload (edge)', async () => {
    await expect(forceReloadKalenders(member, fixtureLoader))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})
