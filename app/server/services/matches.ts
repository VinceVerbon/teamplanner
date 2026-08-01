import { createError } from 'h3'
import { eq, and, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { parseIcalEvents, deriveMatch } from '../utils/ical'
import { getTeamOr404, requireTeamManager, validateTimes, validateSessionRefs } from './trainings'
import { trainingSessions, clubs } from '../db/schema'

export interface MatchRow {
  externalUid: string | null
  date: string
  startTime: string
  endTime: string
  opponent: string
  homeAway: 'home' | 'away'
  locationText: string | null
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Manual match creation (F12). Matches are exempt from no-training periods. */
export async function createMatch(requesterId: string, teamId: string, input: {
  date: string
  startTime: string
  endTime?: string
  opponent: string
  homeAway: 'home' | 'away'
  locationId?: string | null
  locationText?: string | null
}) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  const endTime = input.endTime ?? addMinutes(input.startTime, 120)
  validateTimes(input.startTime, endTime)
  const opponent = input.opponent.trim()
  if (opponent.length < 2) throw createError({ statusCode: 400, statusMessage: 'Opponent is required' })
  if (!input.locationId && !input.locationText?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'A location (register or free text) is required' })
  }
  await validateSessionRefs(team.clubId, teamId, input.locationId ?? null)
  const [match] = await getDb().insert(trainingSessions).values({
    clubId: team.clubId,
    teamId,
    type: 'match',
    date: input.date,
    startTime: input.startTime,
    endTime,
    opponent,
    homeAway: input.homeAway,
    locationId: input.locationId ?? null,
    locationText: input.locationText?.trim() || null
  }).returning()
  return match!
}

/**
 * F21 step 1: parse a Sportlink .ical export and PREVIEW what an import would do.
 * Nothing is written. Rows the parser cannot turn into a match (no date/time, or a
 * summary that does not look like "us - them") are reported under `skipped`.
 */
export async function previewMatchImport(requesterId: string, teamId: string, icalText: string) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  const db = getDb()
  const [club] = await db.select().from(clubs).where(eq(clubs.id, team.clubId))
  const events = parseIcalEvents(icalText)
  const rows: (MatchRow & { summary: string | null, utcFlag: boolean, alreadyImported: boolean })[] = []
  const skipped: { summary: string | null, reason: string }[] = []
  for (const ev of events) {
    if (!ev.date || !ev.startTime) {
      skipped.push({ summary: ev.summary, reason: 'geen datum/tijd (bijv. hele-dag item)' })
      continue
    }
    const derived = ev.summary ? deriveMatch(ev.summary, [club!.name, team.name]) : null
    if (!derived) {
      skipped.push({ summary: ev.summary, reason: 'kon tegenstander/thuis-uit niet afleiden uit de titel' })
      continue
    }
    rows.push({
      externalUid: ev.uid,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime ?? addMinutes(ev.startTime, 120),
      opponent: derived.opponent,
      homeAway: derived.homeAway,
      locationText: ev.location,
      summary: ev.summary,
      utcFlag: ev.utc,
      alreadyImported: false
    })
  }
  // flag rows whose UID already exists for this team (re-import)
  const uids = rows.map(r => r.externalUid).filter((u): u is string => !!u)
  if (uids.length > 0) {
    const existing = await db.select({ uid: trainingSessions.externalUid }).from(trainingSessions)
      .where(and(eq(trainingSessions.teamId, teamId), inArray(trainingSessions.externalUid, uids)))
    const seen = new Set(existing.map(e => e.uid))
    for (const r of rows) r.alreadyImported = !!r.externalUid && seen.has(r.externalUid)
  }
  return { rows, skipped }
}

/**
 * F21 step 2: import previewed (possibly user-corrected) rows as matches.
 * Rows whose externalUid already exists for the team are skipped (safe re-import);
 * so are UID-less rows that match an existing match on date+time+opponent.
 */
export async function importMatches(requesterId: string, teamId: string, rows: MatchRow[]) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  const db = getDb()
  const existing = await db.select({
    externalUid: trainingSessions.externalUid,
    date: trainingSessions.date,
    startTime: trainingSessions.startTime,
    opponent: trainingSessions.opponent
  }).from(trainingSessions)
    .where(and(eq(trainingSessions.teamId, teamId), eq(trainingSessions.type, 'match')))
  const seenUids = new Set(existing.map(e => e.externalUid).filter(Boolean))
  const seenNatural = new Set(existing.map(e => `${e.date}|${e.startTime}|${e.opponent?.toLowerCase()}`))
  let imported = 0
  let skipped = 0
  for (const row of rows) {
    validateTimes(row.startTime, row.endTime)
    const naturalKey = `${row.date}|${row.startTime}|${row.opponent.toLowerCase()}`
    if ((row.externalUid && seenUids.has(row.externalUid)) || seenNatural.has(naturalKey)) {
      skipped++
      continue
    }
    await db.insert(trainingSessions).values({
      clubId: team.clubId,
      teamId,
      type: 'match',
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      opponent: row.opponent.trim(),
      homeAway: row.homeAway,
      locationText: row.locationText?.trim() || null,
      externalUid: row.externalUid
    })
    if (row.externalUid) seenUids.add(row.externalUid)
    seenNatural.add(naturalKey)
    imported++
  }
  return { imported, skipped }
}
