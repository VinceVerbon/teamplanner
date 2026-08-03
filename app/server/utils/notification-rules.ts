// F16 automated team email - pure rules and message bodies.
//
// Deliberately free of DB and mailer access so the timing boundaries and the Dutch copy
// are testable without a database. The dispatcher in services/notifications.ts supplies
// the rows and performs the sending.

import { sessionStart } from './absence-rules'

export type NotificationKind = 'reminder' | 'match-info' | 'absence-nudge'

// How long before kick-off each kind becomes due. A kind fires once per (session,
// recipient) - the sent_notifications ledger, not this table, guarantees that.
export const LEAD_HOURS: Record<NotificationKind, number> = {
  'match-info': 48,
  'reminder': 24,
  'absence-nudge': 4
}

// The per-member opt-out column backing each kind (F16 "per-member opt-out").
export const OPT_OUT_COLUMN: Record<NotificationKind, 'mailReminders' | 'mailMatchInfo' | 'mailAbsenceNudges'> = {
  'reminder': 'mailReminders',
  'match-info': 'mailMatchInfo',
  'absence-nudge': 'mailAbsenceNudges'
}

export interface NotifiableSession {
  id: string
  teamId: string
  type: 'training' | 'match'
  date: string // YYYY-MM-DD
  startTime: string // HH:MM
  endTime: string | null
  status: 'scheduled' | 'cancelled'
  opponent: string | null
  homeAway: 'home' | 'away' | null
  locationName: string | null
  trainerName?: string | null
}

// Start moment comes from the F13 helper (imported above) so absence classification and
// mail timing can never drift apart on how a session start is interpreted. Deliberately
// not re-exported: one auto-import source for that name only.

// Due from `leadHours` before the start until the start itself. Never after kick-off:
// a dispatcher that was down for a day must not send stale reminders when it returns.
export function isWithinLead(start: Date, now: Date, leadHours: number): boolean {
  const from = start.getTime() - leadHours * 3600_000
  const t = now.getTime()
  return t >= from && t < start.getTime()
}

// Which kinds are due for this session right now. Cancelled sessions are silent here -
// their one mail is the event-driven cancellation notice, sent when they are cancelled.
// A training gets the generic reminder, a match gets the richer match-info instead, so
// no session ever produces both.
export function dueKinds(session: NotifiableSession, now: Date): NotificationKind[] {
  if (session.status !== 'scheduled') return []
  const start = sessionStart(session.date, session.startTime)
  const kinds: NotificationKind[] = []
  if (session.type === 'match') {
    if (isWithinLead(start, now, LEAD_HOURS['match-info'])) kinds.push('match-info')
  } else {
    if (isWithinLead(start, now, LEAD_HOURS.reminder)) kinds.push('reminder')
  }
  if (isWithinLead(start, now, LEAD_HOURS['absence-nudge'])) kinds.push('absence-nudge')
  return kinds
}

// --- Dutch copy -------------------------------------------------------------------

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

export function formatDateNl(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d!)
  return `${WEEKDAYS[dt.getDay()]} ${d} ${MONTHS[m! - 1]} ${y}`
}

function timeRange(session: NotifiableSession): string {
  return session.endTime ? `${session.startTime} - ${session.endTime}` : session.startTime
}

function whereLine(session: NotifiableSession): string {
  return session.locationName ? `Locatie: ${session.locationName}` : 'Locatie: nog niet bekend'
}

export function matchTitle(session: NotifiableSession, teamName: string): string {
  if (!session.opponent) return teamName
  return session.homeAway === 'away'
    ? `${session.opponent} - ${teamName}`
    : `${teamName} - ${session.opponent}`
}

export interface BuiltMail { subject: string, text: string }

export function buildReminderMail(session: NotifiableSession, teamName: string, recipientName: string, scheduleUrl: string): BuiltMail {
  return {
    subject: `teamplanner - training ${teamName} op ${formatDateNl(session.date)}`,
    text: [
      `Hoi ${recipientName},`,
      `Morgen staat er een training van ${teamName} op het programma.`,
      `Wanneer: ${formatDateNl(session.date)}, ${timeRange(session)}\n${whereLine(session)}`,
      `Kun je er niet bij zijn? Meld je dan af via ${scheduleUrl}`,
      `Je kunt deze herinneringen uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}

export function buildMatchInfoMail(session: NotifiableSession, teamName: string, recipientName: string, scheduleUrl: string): BuiltMail {
  const thuisUit = session.homeAway === 'away' ? 'uit' : 'thuis'
  return {
    subject: `teamplanner - wedstrijd ${matchTitle(session, teamName)} op ${formatDateNl(session.date)}`,
    text: [
      `Hoi ${recipientName},`,
      `${matchTitle(session, teamName)} (${thuisUit}) wordt gespeeld op ${formatDateNl(session.date)}.`,
      `Aanvang: ${timeRange(session)}\n${whereLine(session)}`,
      `Kun je er niet bij zijn? Meld je dan af via ${scheduleUrl}`,
      `Je kunt deze wedstrijdmails uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}

export function buildAbsenceNudgeMail(session: NotifiableSession, teamName: string, recipientName: string, playerName: string, isSelf: boolean, scheduleUrl: string): BuiltMail {
  const what = session.type === 'match' ? matchTitle(session, teamName) : `training ${teamName}`
  const who = isSelf ? 'Je wordt verwacht' : `${playerName} wordt verwacht`
  return {
    subject: `teamplanner - vanavond${session.type === 'match' ? ' wedstrijd' : ' training'}: ${teamName}`,
    text: [
      `Hoi ${recipientName},`,
      `${who} bij ${what} vandaag om ${session.startTime}.`,
      whereLine(session),
      isSelf
        ? `Lukt het toch niet? Meld je dan nu af via ${scheduleUrl} - dan weet de trainer waar hij aan toe is.`
        : `Lukt het toch niet? Meld ${playerName} dan nu af via ${scheduleUrl} - dan weet de trainer waar hij aan toe is.`,
      `Je kunt deze berichten uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}

export function buildCancellationMail(session: NotifiableSession, teamName: string, recipientName: string, reason: string, scheduleUrl: string): BuiltMail {
  const what = session.type === 'match' ? `wedstrijd ${matchTitle(session, teamName)}` : `training ${teamName}`
  return {
    subject: `teamplanner - afgelast: ${what} op ${formatDateNl(session.date)}`,
    text: [
      `Hoi ${recipientName},`,
      `De ${what} van ${formatDateNl(session.date)}, ${timeRange(session)} gaat NIET door.`,
      `Reden: ${reason}`,
      `Het bijgewerkte programma staat op ${scheduleUrl}`,
      `Je kunt deze wijzigingsberichten uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}

// Which fields actually moved. Returned lines are shown verbatim in the change mail, so
// an unchanged field must never produce a line.
export function describeChanges(before: NotifiableSession, after: NotifiableSession): string[] {
  const lines: string[] = []
  if (before.date !== after.date) lines.push(`Datum: ${formatDateNl(before.date)} -> ${formatDateNl(after.date)}`)
  if (before.startTime !== after.startTime) lines.push(`Aanvang: ${before.startTime} -> ${after.startTime}`)
  if (before.endTime !== after.endTime) lines.push(`Eindtijd: ${before.endTime ?? 'onbekend'} -> ${after.endTime ?? 'onbekend'}`)
  if (before.locationName !== after.locationName) lines.push(`Locatie: ${before.locationName ?? 'onbekend'} -> ${after.locationName ?? 'onbekend'}`)
  return lines
}

export function buildChangeMail(after: NotifiableSession, teamName: string, recipientName: string, changes: string[], scheduleUrl: string): BuiltMail {
  const what = after.type === 'match' ? `wedstrijd ${matchTitle(after, teamName)}` : `training ${teamName}`
  return {
    subject: `teamplanner - gewijzigd: ${what} op ${formatDateNl(after.date)}`,
    text: [
      `Hoi ${recipientName},`,
      `De ${what} is gewijzigd:`,
      changes.map(c => `- ${c}`).join('\n'),
      `Het bijgewerkte programma staat op ${scheduleUrl}`,
      `Je kunt deze wijzigingsberichten uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}

export function buildReinstatedMail(session: NotifiableSession, teamName: string, recipientName: string, scheduleUrl: string): BuiltMail {
  const what = session.type === 'match' ? `wedstrijd ${matchTitle(session, teamName)}` : `training ${teamName}`
  return {
    subject: `teamplanner - gaat toch door: ${what} op ${formatDateNl(session.date)}`,
    text: [
      `Hoi ${recipientName},`,
      `De eerder afgelaste ${what} van ${formatDateNl(session.date)}, ${timeRange(session)} gaat toch door.`,
      whereLine(session),
      `Het bijgewerkte programma staat op ${scheduleUrl}`,
      `Je kunt deze wijzigingsberichten uitzetten bij Mijn account > E-mailvoorkeuren.`
    ].join('\n\n')
  }
}
