// F29 (F26 leftover): week numbers for the schedule views, driven by the instance
// weekNumbering setting. Pure and UTC-safe on 'YYYY-MM-DD' strings.
// - 'iso': ISO-8601 - weeks start Monday, week 1 is the week containing the first
//   Thursday of the year (equivalently: containing Jan 4).
// - 'us': weeks start Sunday, week 1 is the week containing Jan 1.

export type WeekNumberingScheme = 'iso' | 'us'

const DAY_MS = 86400000

function isoWeekNumber(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const weekday = date.getUTCDay() || 7 // Mon=1 .. Sun=7
  // Shift to the Thursday of this ISO week; its calendar year owns the week.
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.floor((date.getTime() - yearStart) / DAY_MS / 7) + 1
}

function usWeekNumber(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / DAY_MS) + 1
  // Pad the first partial week with the weekdays Jan 1 sits after (Sunday start).
  return Math.ceil((dayOfYear + jan1.getUTCDay()) / 7)
}

export function weekNumber(dateStr: string, scheme: WeekNumberingScheme): number {
  return scheme === 'us' ? usWeekNumber(dateStr) : isoWeekNumber(dateStr)
}
