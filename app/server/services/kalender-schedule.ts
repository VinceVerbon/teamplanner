import { createError } from 'h3'
import { eq, and, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getTeamOr404, requireTeamManager, validateTimes } from './trainings'
import { trainingSessions, speeldagKalenderDays, speeldagKalenderCells } from '../db/schema'

// F29: consume the team's speeldagenkalender column (F28) in schedule planning.
// Kalender days become importable PLACEHOLDER matches; real Sportlink imports (F21)
// coexist (different opponent -> different natural key) and placeholders are removed
// manually. The externalUid namespace `kalender:<date>` rides the existing
// (teamId, externalUid) unique index for idempotent re-import.

const UID_PREFIX = 'kalender:'
const PLACEHOLDER_LOCATION = 'n.t.b.'
const DEFAULT_MATCH_MINUTES = 120

const uidForDate = (date: string) => `${UID_PREFIX}${date}`

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export type KalenderCellClass = 'speeldag' | 'reserve' | 'vrij'

// Cell values are free text from the KNVB PDFs. Observed vocabulary (fixtures):
// play: WD, WD NJ/VJ, WD (zat)/(zon), Fase N, Start Fase N, Week N, Beker*, bare
//       round numbers (landelijk), Final League, Finale*, Q1/Q2*, Jeugdcup*,
//       Div*, Hfdkl*, Midweekse Bekerronde.
// free: Vrij, NC, '-', empty (empty cells are ABSENT rows in the DB).
// Everything combined with '/' (Inh. / Bek., Vrij / Inhaal, WD NJ (M) / Inh.) is
// genuinely ambiguous -> 'reserve', as are Inhaal/Inh./Uitwijk and anything unknown.
const FREE_VALUES = new Set(['', '-', 'vrij', 'nc'])
const PLAY_PATTERNS = [
  /^wd/i, /^fase \d/i, /^start fase/i, /^week \d/i, /^beker/i, /^\d+$/,
  /^final/i, /^finale/i, /^q\d/i, /^jeugdcup/i, /^div/i, /^hfdkl/i,
  /^midweekse beker/i
]

export function classifyKalenderCell(value: string | null): KalenderCellClass {
  const v = (value ?? '').trim()
  if (FREE_VALUES.has(v.toLowerCase())) return 'vrij'
  if (v.includes('/')) return 'reserve'
  if (PLAY_PATTERNS.some(re => re.test(v))) return 'speeldag'
  return 'reserve'
}

interface KalenderDayRow {
  date: string
  dateEnd: string | null
  label: string
  remark: string | null
  value: string
}

/** All non-vrij days of the team's kalender column, in kalender order. */
async function columnDays(kalenderColumnId: string): Promise<(KalenderDayRow & { classification: Exclude<KalenderCellClass, 'vrij'> })[]> {
  const db = getDb()
  const rows = await db.select({
    date: speeldagKalenderDays.dateStart,
    dateEnd: speeldagKalenderDays.dateEnd,
    label: speeldagKalenderDays.label,
    remark: speeldagKalenderDays.remark,
    value: speeldagKalenderCells.value,
    position: speeldagKalenderDays.position
  }).from(speeldagKalenderCells)
    .innerJoin(speeldagKalenderDays, eq(speeldagKalenderCells.dayId, speeldagKalenderDays.id))
    .where(eq(speeldagKalenderCells.columnId, kalenderColumnId))
    .orderBy(speeldagKalenderDays.position)
  return rows
    .map((r) => {
      const classification = classifyKalenderCell(r.value)
      return { date: r.date, dateEnd: r.dateEnd, label: r.label, remark: r.remark, value: r.value, classification }
    })
    .filter((r): r is KalenderDayRow & { classification: 'speeldag' | 'reserve' } => r.classification !== 'vrij')
}

async function getTeamWithKalenderOr409(requesterId: string, teamId: string) {
  const team = await getTeamOr404(teamId)
  await requireTeamManager(requesterId, team.clubId, teamId)
  if (!team.kalenderColumnId) {
    throw createError({ statusCode: 409, statusMessage: 'No speeldagenkalender category selected for this team' })
  }
  return team
}

/**
 * Preview (F21 shape: nothing is written): the team's kalender days that could
 * become placeholder matches - 'speeldag' preselectable, 'reserve' offered unchecked.
 */
export async function listKalenderWeekends(requesterId: string, teamId: string) {
  const team = await getTeamWithKalenderOr409(requesterId, teamId)
  const days = await columnDays(team.kalenderColumnId!)
  const db = getDb()
  const uids = days.map(d => uidForDate(d.date))
  const existing = uids.length > 0
    ? await db.select({ uid: trainingSessions.externalUid }).from(trainingSessions)
        .where(and(eq(trainingSessions.teamId, teamId), inArray(trainingSessions.externalUid, uids)))
    : []
  const seen = new Set(existing.map(e => e.uid))
  return days.map(d => ({ ...d, alreadyImported: seen.has(uidForDate(d.date)) }))
}

/**
 * Import selected kalender days as placeholder matches. Dates are re-validated
 * against the kalender server-side; a weekend row lands on its FIRST day (dateStart)
 * at the caller-chosen start time (+2h end by default). Re-import is idempotent per
 * (team, date). Matches are exempt from no-training periods, like all matches.
 */
export async function importKalenderWeekends(requesterId: string, teamId: string, input: {
  dates: string[]
  startTime: string
  endTime?: string
}) {
  const team = await getTeamWithKalenderOr409(requesterId, teamId)
  const endTime = input.endTime ?? addMinutes(input.startTime, DEFAULT_MATCH_MINUTES)
  validateTimes(input.startTime, endTime)
  const days = await columnDays(team.kalenderColumnId!)
  const byDate = new Map(days.map(d => [d.date, d]))
  const db = getDb()
  const existing = await db.select({ uid: trainingSessions.externalUid }).from(trainingSessions)
    .where(and(eq(trainingSessions.teamId, teamId), eq(trainingSessions.type, 'match')))
  const seenUids = new Set(existing.map(e => e.uid).filter(Boolean))
  let imported = 0
  let skipped = 0
  for (const date of input.dates) {
    const day = byDate.get(date)
    if (!day) {
      throw createError({ statusCode: 400, statusMessage: `${date} is not a speeldag or reserve day on the team's kalender` })
    }
    const uid = uidForDate(date)
    if (seenUids.has(uid)) {
      skipped++
      continue
    }
    await db.insert(trainingSessions).values({
      clubId: team.clubId,
      teamId,
      type: 'match',
      date,
      startTime: input.startTime,
      endTime,
      opponent: `Speeldag ${day.value}`.trim(),
      homeAway: null,
      locationText: PLACEHOLDER_LOCATION,
      externalUid: uid
    })
    seenUids.add(uid)
    imported++
  }
  return { imported, skipped }
}
