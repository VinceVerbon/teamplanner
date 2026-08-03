import { createError } from 'h3'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { requireInstanceAdmin } from './instance'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam } from '../utils/roles'
import { parseKalenderItems, type ParsedKalender } from '../utils/knvb-kalender'
import { describeChange, type KalenderChange } from '#shared/utils/speeldagen-diff'
import {
  speeldagKalenders, speeldagKalenderColumns, speeldagKalenderDays, speeldagKalenderCells,
  speeldagKalenderChanges, clubs, teams
} from '../db/schema'
import { getKnvbSources, type KalenderRegion } from './knvb-sources'

// F28: KNVB speeldagenkalenders - fetched and parsed CENTRALLY (instance admin).
// Lifecycle: fetched kalenders are 'pending' until activated; once an active kalender
// exists, a fetch produces a diff that the admin processes or cancels; processed
// changes land in the central changelog (visible to all clubs and staff).

// Region model, season and source URLs live in knvb-sources.ts (admin-confirmable
// discovery, built-in seed as fallback); re-exported here for existing importers.
export { KNVB_SEASON, KNVB_SOURCES, type KalenderRegion } from './knvb-sources'

export type PdfLoader = (url: string) => Promise<Uint8Array>

const defaultPdfLoader: PdfLoader = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download mislukt (${res.status}) voor ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function parsePdf(data: Uint8Array): Promise<ParsedKalender> {
  const { extractPdfTextItems } = await import('../utils/knvb-pdf')
  const pages = await extractPdfTextItems(data)
  if (pages.length === 0 || !pages[0]) throw new Error('PDF bevat geen pagina\'s')
  // The 2026/'27 kalenders are single-page; the grid always sits on page 1.
  return parseKalenderItems(pages[0])
}

// --- storage ---

async function findKalender(season: string, region: KalenderRegion, status: 'pending' | 'active') {
  const db = getDb()
  const [row] = await db.select().from(speeldagKalenders).where(and(
    eq(speeldagKalenders.season, season),
    eq(speeldagKalenders.region, region),
    eq(speeldagKalenders.status, status)
  ))
  return row ?? null
}

async function deleteKalender(id: string) {
  await getDb().delete(speeldagKalenders).where(eq(speeldagKalenders.id, id))
}

/** Insert a parsed kalender with the given status; replaces an existing same-status row. */
export async function storeKalender(
  parsed: ParsedKalender, region: KalenderRegion, season: string, sourceUrl: string,
  status: 'pending' | 'active'
) {
  const db = getDb()
  const existing = await findKalender(season, region, status)
  if (existing) await deleteKalender(existing.id)
  const [kalender] = await db.insert(speeldagKalenders)
    .values({ season, region, title: parsed.title, sourceUrl, status }).returning()
  const columnRows = parsed.columns.length
    ? await db.insert(speeldagKalenderColumns).values(
        parsed.columns.map((title, i) => ({ kalenderId: kalender!.id, position: i, title }))
      ).returning()
    : []
  for (const [i, day] of parsed.days.entries()) {
    const [dayRow] = await db.insert(speeldagKalenderDays).values({
      kalenderId: kalender!.id,
      position: i,
      label: day.label,
      dateStart: day.dateStart,
      dateEnd: day.dateEnd,
      remark: day.remark
    }).returning()
    const cells = day.cells
      .map((value, c) => ({ value, columnId: columnRows[c]?.id }))
      .filter(x => x.value && x.columnId)
      .map(x => ({
        kalenderId: kalender!.id, dayId: dayRow!.id, columnId: x.columnId!, value: x.value!
      }))
    if (cells.length) await db.insert(speeldagKalenderCells).values(cells)
  }
  return kalender!
}

/** Rebuild the ParsedKalender shape from the database (for diffing and display). */
export async function getKalenderGrid(kalenderId: string): Promise<ParsedKalender & { id: string }> {
  const db = getDb()
  const [kalender] = await db.select().from(speeldagKalenders).where(eq(speeldagKalenders.id, kalenderId))
  if (!kalender) throw createError({ statusCode: 404, statusMessage: 'Kalender niet gevonden' })
  const columns = await db.select().from(speeldagKalenderColumns)
    .where(eq(speeldagKalenderColumns.kalenderId, kalenderId))
    .orderBy(speeldagKalenderColumns.position)
  const days = await db.select().from(speeldagKalenderDays)
    .where(eq(speeldagKalenderDays.kalenderId, kalenderId))
    .orderBy(speeldagKalenderDays.position)
  const cells = await db.select().from(speeldagKalenderCells)
    .where(eq(speeldagKalenderCells.kalenderId, kalenderId))
  const cellMap = new Map(cells.map(c => [`${c.dayId}|${c.columnId}`, c.value]))
  return {
    id: kalender.id,
    title: kalender.title,
    columns: columns.map(c => c.title),
    days: days.map(d => ({
      label: d.label,
      dateStart: d.dateStart,
      dateEnd: d.dateEnd,
      remark: d.remark,
      cells: columns.map(c => cellMap.get(`${d.id}|${c.id}`) ?? null)
    }))
  }
}

// --- diff ---

export function diffKalenders(active: ParsedKalender, next: ParsedKalender): KalenderChange[] {
  const changes: KalenderChange[] = []
  const activeCols = new Set(active.columns)
  const nextCols = new Set(next.columns)
  for (const c of active.columns) if (!nextCols.has(c)) changes.push({ kind: 'column-removed', columnTitle: c })
  for (const c of next.columns) if (!activeCols.has(c)) changes.push({ kind: 'column-added', columnTitle: c })
  const sharedCols = next.columns.filter(c => activeCols.has(c))

  const activeDays = new Map(active.days.map(d => [d.label, d]))
  const nextDays = new Map(next.days.map(d => [d.label, d]))
  for (const d of active.days) if (!nextDays.has(d.label)) changes.push({ kind: 'day-removed', dayLabel: d.label })
  for (const d of next.days) {
    const old = activeDays.get(d.label)
    if (!old) {
      changes.push({ kind: 'day-added', dayLabel: d.label })
      continue
    }
    const oldDates = old.dateEnd ? `${old.dateStart} t/m ${old.dateEnd}` : old.dateStart
    const newDates = d.dateEnd ? `${d.dateStart} t/m ${d.dateEnd}` : d.dateStart
    if (oldDates !== newDates) {
      changes.push({ kind: 'day-dates-changed', dayLabel: d.label, before: oldDates, after: newDates })
    }
    if ((old.remark ?? '') !== (d.remark ?? '')) {
      changes.push({ kind: 'day-remark-changed', dayLabel: d.label, before: old.remark, after: d.remark })
    }
    for (const col of sharedCols) {
      const oldVal = old.cells[active.columns.indexOf(col)] ?? null
      const newVal = d.cells[next.columns.indexOf(col)] ?? null
      if ((oldVal ?? '') !== (newVal ?? '')) {
        changes.push({ kind: 'cell-changed', dayLabel: d.label, columnTitle: col, before: oldVal, after: newVal })
      }
    }
  }
  return changes
}

// --- fetch / activate / cancel / force reload ---

export interface FetchRegionResult {
  region: KalenderRegion
  status: 'pending-new' | 'no-changes' | 'changes-pending' | 'error'
  kalenderId?: string
  columns?: number
  days?: number
  changes?: KalenderChange[]
  error?: string
}

/** Fetch + parse all KNVB kalenders. New regions land as pending; for regions with an
 * active kalender the result is a diff (stored pending only when there ARE changes). */
export async function fetchKalenders(requesterId: string, loadPdf: PdfLoader = defaultPdfLoader): Promise<FetchRegionResult[]> {
  await requireInstanceAdmin(requesterId)
  const { season, sources } = await getKnvbSources()
  const results: FetchRegionResult[] = []
  for (const source of sources) {
    try {
      const parsed = await parsePdf(await loadPdf(source.url))
      const active = await findKalender(season, source.region, 'active')
      if (!active) {
        const stored = await storeKalender(parsed, source.region, season, source.url, 'pending')
        results.push({
          region: source.region, status: 'pending-new', kalenderId: stored.id,
          columns: parsed.columns.length, days: parsed.days.length
        })
        continue
      }
      const changes = diffKalenders(await getKalenderGrid(active.id), parsed)
      if (changes.length === 0) {
        const stale = await findKalender(season, source.region, 'pending')
        if (stale) await deleteKalender(stale.id)
        results.push({ region: source.region, status: 'no-changes' })
        continue
      }
      const stored = await storeKalender(parsed, source.region, season, source.url, 'pending')
      results.push({
        region: source.region, status: 'changes-pending', kalenderId: stored.id,
        columns: parsed.columns.length, days: parsed.days.length, changes
      })
    } catch (e) {
      results.push({ region: source.region, status: 'error', error: (e as Error).message })
    }
  }
  return results
}

async function logChanges(season: string, region: string, batchId: string, changes: KalenderChange[]) {
  if (changes.length === 0) return
  await getDb().insert(speeldagKalenderChanges).values(changes.map(c => ({
    batchId, season, region, kind: c.kind, description: describeChange(c)
  })))
}

/** The diff between a pending kalender and its active predecessor (for the review screen). */
export async function getPendingDiff(requesterId: string, kalenderId: string): Promise<KalenderChange[]> {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const [pending] = await db.select().from(speeldagKalenders).where(eq(speeldagKalenders.id, kalenderId))
  if (!pending || pending.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'Geen kalender in afwachting gevonden' })
  }
  const active = await findKalender(pending.season, pending.region as KalenderRegion, 'active')
  if (!active) return []
  return diffKalenders(await getKalenderGrid(active.id), await getKalenderGrid(pending.id))
}

/**
 * Activate a pending kalender. First activation logs one entry; when it replaces an
 * active kalender ONLY the diff is processed into the changelog, and team category
 * selections are remapped to the new columns by title.
 */
export async function activateKalender(requesterId: string, kalenderId: string) {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const [pending] = await db.select().from(speeldagKalenders).where(eq(speeldagKalenders.id, kalenderId))
  if (!pending || pending.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'Geen kalender in afwachting gevonden' })
  }
  const active = await findKalender(pending.season, pending.region as KalenderRegion, 'active')
  const batchId = crypto.randomUUID()
  let processed: KalenderChange[]
  if (active) {
    processed = diffKalenders(await getKalenderGrid(active.id), await getKalenderGrid(pending.id))
    // Remap team selections by column title before the old columns cascade away.
    const oldCols = await db.select().from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, active.id))
    const newCols = await db.select().from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, pending.id))
    for (const oldCol of oldCols) {
      const match = newCols.find(c => c.title === oldCol.title)
      if (match) {
        await db.update(teams).set({ kalenderColumnId: match.id })
          .where(eq(teams.kalenderColumnId, oldCol.id))
      }
    }
    await deleteKalender(active.id)
  } else {
    processed = [{ kind: 'kalender-activated' }]
  }
  await db.update(speeldagKalenders).set({ status: 'active' }).where(eq(speeldagKalenders.id, pending.id))
  await logChanges(pending.season, pending.region, batchId, processed)
  return { activated: true, processedChanges: processed.length }
}

/** Cancel pending changes for now: the active kalender stays untouched. */
export async function discardPendingKalender(requesterId: string, kalenderId: string) {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const [pending] = await db.select().from(speeldagKalenders).where(eq(speeldagKalenders.id, kalenderId))
  if (!pending || pending.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'Geen kalender in afwachting gevonden' })
  }
  await deleteKalender(pending.id)
  return { discarded: true }
}

/**
 * Force reload: dump the whole speeldagenkalender model and renew it from the PDFs.
 * Separate deliberate action (the UI warns first); team selections are remapped by
 * column title where possible.
 */
export async function forceReloadKalenders(requesterId: string, loadPdf: PdfLoader = defaultPdfLoader): Promise<FetchRegionResult[]> {
  await requireInstanceAdmin(requesterId)
  const db = getDb()
  const { season, sources } = await getKnvbSources()
  const batchId = crypto.randomUUID()
  const results: FetchRegionResult[] = []
  for (const source of sources) {
    try {
      const parsed = await parsePdf(await loadPdf(source.url))
      const oldOnes = await db.select().from(speeldagKalenders).where(and(
        eq(speeldagKalenders.season, season),
        eq(speeldagKalenders.region, source.region)
      ))
      const oldActive = oldOnes.find(k => k.status === 'active')
      const oldCols = oldActive
        ? await db.select().from(speeldagKalenderColumns)
            .where(eq(speeldagKalenderColumns.kalenderId, oldActive.id))
        : []
      // Snapshot team selections BEFORE deleting: the FK nulls them on cascade.
      const oldColIds = oldCols.map(c => c.id)
      const affectedTeams = oldColIds.length
        ? await db.select({ id: teams.id, kalenderColumnId: teams.kalenderColumnId })
            .from(teams).where(inArray(teams.kalenderColumnId, oldColIds))
        : []
      const titleByColId = new Map(oldCols.map(c => [c.id, c.title]))
      for (const k of oldOnes) await deleteKalender(k.id)
      const stored = await storeKalender(parsed, source.region, season, source.url, 'active')
      const newCols = await db.select().from(speeldagKalenderColumns)
        .where(eq(speeldagKalenderColumns.kalenderId, stored.id))
      for (const team of affectedTeams) {
        const title = titleByColId.get(team.kalenderColumnId!)
        const match = newCols.find(c => c.title === title)
        if (match) {
          await db.update(teams).set({ kalenderColumnId: match.id }).where(eq(teams.id, team.id))
        }
      }
      await logChanges(season, source.region, batchId, [{ kind: 'kalender-force-reloaded' }])
      results.push({
        region: source.region, status: 'pending-new', kalenderId: stored.id,
        columns: parsed.columns.length, days: parsed.days.length
      })
    } catch (e) {
      results.push({ region: source.region, status: 'error', error: (e as Error).message })
    }
  }
  return results
}

// --- listing / changelog / team selection ---

export async function listKalenders() {
  const db = getDb()
  const rows = await db.select().from(speeldagKalenders)
    .orderBy(speeldagKalenders.region, speeldagKalenders.status)
  const result = []
  for (const k of rows) {
    const cols = await db.select({ id: speeldagKalenderColumns.id }).from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, k.id))
    const days = await db.select({ id: speeldagKalenderDays.id }).from(speeldagKalenderDays)
      .where(eq(speeldagKalenderDays.kalenderId, k.id))
    result.push({
      id: k.id, season: k.season, region: k.region, title: k.title, status: k.status,
      fetchedAt: k.fetchedAt, columns: cols.length, days: days.length
    })
  }
  return result
}

/** Central changelog of processed kalender changes - visible to all clubs and staff. */
export async function listKalenderChanges(limit = 200) {
  return getDb().select().from(speeldagKalenderChanges)
    .orderBy(desc(speeldagKalenderChanges.changedAt))
    .limit(limit)
}

/** Team-level options: columns of the club-region kalender, plus the nationale
 * kalenders when the club has flagged nationally playing teams (F28 selection model). */
export async function getTeamKalenderOptions(requesterId: string, teamId: string) {
  const db = getDb()
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, team.clubId) && !isActiveStaffOfTeam(roles, teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
  }
  const [club] = await db.select().from(clubs).where(eq(clubs.id, team.clubId))
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  const regions: KalenderRegion[] = []
  if (club.region) regions.push(club.region as KalenderRegion)
  if (club.hasNationalTeams) regions.push('landelijk', 'landelijk-jeugd')
  if (regions.length === 0) return { clubRegion: club.region, options: [] }
  const kalenders = await db.select().from(speeldagKalenders).where(and(
    eq(speeldagKalenders.status, 'active'),
    inArray(speeldagKalenders.region, regions)
  ))
  const options = []
  for (const k of kalenders) {
    const cols = await db.select().from(speeldagKalenderColumns)
      .where(eq(speeldagKalenderColumns.kalenderId, k.id))
      .orderBy(speeldagKalenderColumns.position)
    options.push(...cols.map(c => ({
      columnId: c.id, region: k.region, season: k.season, title: c.title
    })))
  }
  return { clubRegion: club.region, options, selected: team.kalenderColumnId }
}

/** Set the team's kalender category; the column must be one of the allowed options. */
export async function setTeamKalender(requesterId: string, teamId: string, columnId: string | null) {
  const db = getDb()
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  const roles = await getUserRoles(requesterId)
  if (!isClubAdmin(roles, team.clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (columnId !== null) {
    const { options } = await getTeamKalenderOptions(requesterId, teamId)
    if (!options.some(o => o.columnId === columnId)) {
      throw createError({ statusCode: 400, statusMessage: 'Deze kalenderkolom is niet beschikbaar voor dit team (regio/landelijk-instelling van de club)' })
    }
  }
  const [updated] = await db.update(teams).set({ kalenderColumnId: columnId })
    .where(eq(teams.id, teamId)).returning()
  return { kalenderColumnId: updated!.kalenderColumnId }
}
