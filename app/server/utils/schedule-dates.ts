// F10 pure date logic. All dates are 'YYYY-MM-DD' strings, handled UTC-safe.
// Weekday is ISO: 1 = Monday .. 7 = Sunday.

export interface DateRange { startDate: string, endDate: string }

function toUtc(d: string): Date {
  return new Date(`${d}T00:00:00Z`)
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function isoWeekday(dateStr: string): number {
  const day = toUtc(dateStr).getUTCDay() // 0 = Sunday .. 6 = Saturday
  return day === 0 ? 7 : day
}

export function addDays(dateStr: string, days: number): string {
  const d = toUtc(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return toDateString(d)
}

export function inRange(dateStr: string, range: DateRange): boolean {
  return dateStr >= range.startDate && dateStr <= range.endDate
}

export function inAnyRange(dateStr: string, ranges: DateRange[]): boolean {
  return ranges.some(r => inRange(dateStr, r))
}

/**
 * All dates for a weekly slot: every `weekday` within the season bounds (inclusive),
 * starting no earlier than `from` (if given), skipping dates covered by any closure
 * (club-level and team-level no-training periods alike).
 */
export function slotSessionDates(opts: {
  weekday: number
  seasonStart: string
  seasonEnd: string
  from?: string
  closures?: DateRange[]
}): string[] {
  const { weekday, seasonStart, seasonEnd, from, closures = [] } = opts
  let cursor = from && from > seasonStart ? from : seasonStart
  // advance to the first requested weekday
  const offset = (weekday - isoWeekday(cursor) + 7) % 7
  cursor = addDays(cursor, offset)
  const dates: string[] = []
  while (cursor <= seasonEnd) {
    if (!inAnyRange(cursor, closures)) dates.push(cursor)
    cursor = addDays(cursor, 7)
  }
  return dates
}
