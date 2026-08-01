// F13 pure classification logic. Times are naive local ('YYYY-MM-DD' + 'HH:MM').

export const TIMELY_MINUTES = 90

export type AbsenceClass = 'timely' | 'late' | 'no-show'

export function sessionStart(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00`)
}

/**
 * Classify an absence by when it is reported relative to session start:
 * >= 1.5h before start = timely; between 1.5h and start = late;
 * at/after start = no-show (the notification came too late to count as one).
 */
export function classifyAbsence(date: string, startTime: string, reportedAt: Date): AbsenceClass {
  const start = sessionStart(date, startTime)
  const minutesBefore = (start.getTime() - reportedAt.getTime()) / 60_000
  if (minutesBefore >= TIMELY_MINUTES) return 'timely'
  if (minutesBefore > 0) return 'late'
  return 'no-show'
}
