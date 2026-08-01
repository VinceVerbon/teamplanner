// F21 pure iCalendar parsing - no dependency, only what a Sportlink match export
// needs: VEVENT blocks with UID, DTSTART/DTEND (TZID or naive or Z), SUMMARY, LOCATION.

export interface IcalEvent {
  uid: string | null
  summary: string | null
  location: string | null
  /** 'YYYY-MM-DD' */
  date: string | null
  /** 'HH:MM', null for all-day events */
  startTime: string | null
  endTime: string | null
  /** true when DTSTART was a UTC ('Z') timestamp - times are taken literally, flag it */
  utc: boolean
}

/** RFC 5545 line unfolding: a line starting with space/tab continues the previous line. */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** '20260905T143000[Z]' or '20260905' -> { date, time, utc } */
function parseDateTime(v: string): { date: string | null, time: string | null, utc: boolean } {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return { date: null, time: null, utc: false }
  const date = `${m[1]}-${m[2]}-${m[3]}`
  const time = m[4] ? `${m[4]}:${m[5]}` : null
  return { date, time, utc: !!m[7] }
}

export function parseIcalEvents(text: string): IcalEvent[] {
  const lines = unfold(text)
  const events: IcalEvent[] = []
  let current: Record<string, string> | null = null
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) {
      current = {}
      continue
    }
    if (/^END:VEVENT$/i.test(line.trim())) {
      if (current) {
        const start = current.DTSTART ? parseDateTime(current.DTSTART) : { date: null, time: null, utc: false }
        const end = current.DTEND ? parseDateTime(current.DTEND) : { date: null, time: null, utc: false }
        events.push({
          uid: current.UID ?? null,
          summary: current.SUMMARY ? unescapeText(current.SUMMARY) : null,
          location: current.LOCATION ? unescapeText(current.LOCATION) : null,
          date: start.date,
          startTime: start.time,
          endTime: end.time,
          utc: start.utc
        })
      }
      current = null
      continue
    }
    if (!current) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    // property name may carry params: DTSTART;TZID=Europe/Amsterdam:20260905T143000
    const name = line.slice(0, idx).split(';')[0]!.toUpperCase()
    current[name] = line.slice(idx + 1).trim()
  }
  return events
}

/**
 * Derive opponent + home/away from a Sportlink-style summary
 * ("FC Aalsmeer MO17-4 - RKDES MO17-3"): the home side is listed first.
 * `ownNames` are matched case-insensitively (club name, team name).
 */
export function deriveMatch(summary: string, ownNames: string[]): { opponent: string, homeAway: 'home' | 'away' } | null {
  const parts = summary.split(/\s+-\s+/)
  if (parts.length !== 2) return null
  const [first, second] = parts as [string, string]
  const owns = ownNames.map(n => n.toLowerCase()).filter(n => n.length > 1)
  const isOwn = (s: string) => owns.some(n => s.toLowerCase().includes(n))
  if (isOwn(first) && !isOwn(second)) return { opponent: second.trim(), homeAway: 'home' }
  if (isOwn(second) && !isOwn(first)) return { opponent: first.trim(), homeAway: 'away' }
  return null
}
