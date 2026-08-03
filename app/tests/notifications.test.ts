// Test-set for F16 (automated team email): due-window rules and Dutch copy as pure
// functions, then the dispatcher's idempotency, recipient resolution, per-kind opt-out
// and the event-driven change/cancellation notices.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { sentMails } from '../server/utils/mailer'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer } from '../server/services/members'
import { createSeason, createLocation, createNoTrainingPeriod } from '../server/services/schedule'
import { createOneOffSession, updateSession } from '../server/services/trainings'
import { createMatch } from '../server/services/matches'
import { reportAbsence } from '../server/services/attendance'
import { requestParentLink, confirmParentLink } from '../server/services/parents'
import {
  dispatchDueNotifications, teamRecipients, setMailSettings
} from '../server/services/notifications'
import { sessionStart } from '../server/utils/absence-rules'
import {
  isWithinLead, dueKinds, describeChanges, formatDateNl,
  buildReminderMail, buildMatchInfoMail, buildAbsenceNudgeMail, buildCancellationMail,
  matchTitle, type NotifiableSession
} from '../server/utils/notification-rules'
import { user } from '../server/db/schema'

function base(over: Partial<NotifiableSession> = {}): NotifiableSession {
  return {
    id: 's1',
    teamId: 't1',
    type: 'training',
    date: '2026-09-10',
    startTime: '19:00',
    endTime: '20:30',
    status: 'scheduled',
    opponent: null,
    homeAway: null,
    locationName: 'Sportpark Noord',
    ...over
  }
}

describe('F16 rules - due windows (pure)', () => {
  const start = sessionStart('2026-09-10', '19:00')

  it('parses date + time into a local start moment', () => {
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(8) // September
    expect(start.getDate()).toBe(10)
    expect(start.getHours()).toBe(19)
    expect(start.getMinutes()).toBe(0)
  })

  it('is due from exactly the lead moment until just before the start', () => {
    const exactly24hBefore = new Date(start.getTime() - 24 * 3600_000)
    expect(isWithinLead(start, exactly24hBefore, 24)).toBe(true)
    expect(isWithinLead(start, new Date(exactly24hBefore.getTime() - 60_000), 24)).toBe(false)
    expect(isWithinLead(start, new Date(start.getTime() - 60_000), 24)).toBe(true)
  })

  it('is never due at or after kick-off (a dispatcher that was down sends nothing stale)', () => {
    expect(isWithinLead(start, start, 24)).toBe(false)
    expect(isWithinLead(start, new Date(start.getTime() + 3600_000), 24)).toBe(false)
  })

  it('gives a training the reminder and a match the match-info, never both', () => {
    const t23h = new Date(start.getTime() - 23 * 3600_000)
    expect(dueKinds(base(), t23h)).toContain('reminder')
    expect(dueKinds(base(), t23h)).not.toContain('match-info')

    const match = base({ type: 'match', opponent: 'DVO', homeAway: 'home' })
    const t40h = new Date(start.getTime() - 40 * 3600_000)
    expect(dueKinds(match, t40h)).toEqual(['match-info'])
    expect(dueKinds(match, t23h)).not.toContain('reminder')
  })

  it('adds the absence nudge only inside the last 4 hours', () => {
    expect(dueKinds(base(), new Date(start.getTime() - 5 * 3600_000))).not.toContain('absence-nudge')
    expect(dueKinds(base(), new Date(start.getTime() - 3 * 3600_000))).toContain('absence-nudge')
  })

  it('stays silent for a cancelled session', () => {
    expect(dueKinds(base({ status: 'cancelled' }), new Date(start.getTime() - 3600_000))).toEqual([])
  })
})

describe('F16 rules - copy (pure)', () => {
  it('formats dates in Dutch', () => {
    expect(formatDateNl('2026-09-10')).toBe('donderdag 10 september 2026')
  })

  it('puts the home side first in a match title', () => {
    const home = base({ type: 'match', opponent: 'DVO', homeAway: 'home' })
    const away = base({ type: 'match', opponent: 'DVO', homeAway: 'away' })
    expect(matchTitle(home, 'MO17-4')).toBe('MO17-4 - DVO')
    expect(matchTitle(away, 'MO17-4')).toBe('DVO - MO17-4')
  })

  it('lists only the fields that actually moved', () => {
    const before = base()
    expect(describeChanges(before, base())).toEqual([])
    const moved = describeChanges(before, base({ date: '2026-09-11', startTime: '20:00' }))
    expect(moved).toHaveLength(2)
    expect(moved[0]).toContain('Datum')
    expect(moved[1]).toContain('20:00')
    expect(moved.join(' ')).not.toContain('Locatie')
  })

  it('writes reminder, match and nudge mails with the practical details', () => {
    const reminder = buildReminderMail(base(), 'MO17-4', 'Sam', 'http://x/schedule')
    expect(reminder.subject).toContain('training MO17-4')
    expect(reminder.text).toContain('19:00 - 20:30')
    expect(reminder.text).toContain('Sportpark Noord')
    expect(reminder.text).toContain('http://x/schedule')

    const match = buildMatchInfoMail(base({ type: 'match', opponent: 'DVO', homeAway: 'away' }), 'MO17-4', 'Sam', 'http://x/schedule')
    expect(match.subject).toContain('DVO - MO17-4')
    expect(match.text).toContain('(uit)')

    const selfNudge = buildAbsenceNudgeMail(base(), 'MO17-4', 'Sam', 'Sam', true, 'http://x/schedule')
    expect(selfNudge.text).toContain('Je wordt verwacht')
    const parentNudge = buildAbsenceNudgeMail(base(), 'MO17-4', 'Ouder', 'Sam', false, 'http://x/schedule')
    expect(parentNudge.text).toContain('Sam wordt verwacht')

    const cancelled = buildCancellationMail(base(), 'MO17-4', 'Sam', 'onweer', 'http://x/schedule')
    expect(cancelled.subject).toContain('afgelast')
    expect(cancelled.text).toContain('onweer')
  })

  it('says the location is unknown rather than printing null', () => {
    const mail = buildReminderMail(base({ locationName: null }), 'MO17-4', 'Sam', 'http://x/schedule')
    expect(mail.text).toContain('nog niet bekend')
    expect(mail.text).not.toContain('null')
  })
})

// --- service-level ------------------------------------------------------------------

let admin: string
let coach: string
let playerA: string
let playerB: string
let parentA: string
let outsider: string
let pendingCoach: string
let team: string
let locationId: string

async function makeUser(email: string, name: string, dateOfBirth?: string): Promise<string> {
  const [row] = await getDb().insert(user)
    .values({ name, email, emailVerified: true, dateOfBirth: dateOfBirth ?? null }).returning()
  return row!.id
}

function mailsSince(n: number) {
  return sentMails.slice(n)
}

// A date/time we can aim the clock at deterministically.
const DAY = '2027-03-11'
const AT = '19:00'
const START = sessionStart(DAY, AT)

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@x.nl', 'Admin')
  coach = await makeUser('coach@x.nl', 'Coach')
  playerA = await makeUser('a@x.nl', 'Speler A', '2011-05-04')
  playerB = await makeUser('b@x.nl', 'Speler B', '2011-08-19')
  parentA = await makeUser('parent@x.nl', 'Ouder van A')
  outsider = await makeUser('out@x.nl', 'Buitenstaander')
  pendingCoach = await makeUser('pending@x.nl', 'Aspirant Staf')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { name: 'FC Aalsmeer', slug: 'fc-aalsmeer' })
  team = (await createTeam(admin, club.id, 'MO17-4')).id
  const loc = await createLocation(admin, { name: 'Sportpark Noord', address: 'Dorpsstraat 1' })
  locationId = loc.id
  await createSeason(admin, { name: '2026/27', startDate: '2026-08-01', endDate: '2027-06-30' })
  await assignPlayer(admin, team, 'a@x.nl')
  await assignPlayer(admin, team, 'b@x.nl')
  await addStaff(admin, team, 'coach@x.nl')
  await addStaff(coach, team, 'pending@x.nl') // staff-added staff stays pending (F8)
  const link = await requestParentLink(parentA, 'a@x.nl', 'player')
  await confirmParentLink(playerA, link.token)
})

describe('F16 recipients', () => {
  it('covers players, active parents and active staff - and nobody else', async () => {
    const ids = (await teamRecipients(team, 'reminder')).map(r => r.userId)
    expect(ids).toContain(playerA)
    expect(ids).toContain(playerB)
    expect(ids).toContain(parentA)
    expect(ids).toContain(coach)
    expect(ids).not.toContain(outsider)
    expect(ids).not.toContain(pendingCoach) // pending staff is not yet on the team
    expect(ids).not.toContain(admin)
  })

  it('tells a parent which child the mail is about', async () => {
    const parent = (await teamRecipients(team, 'absence-nudge')).find(r => r.userId === parentA)
    expect(parent?.aboutPlayerId).toBe(playerA)
    expect(parent?.aboutPlayerName).toBe('Speler A')
  })

  it('drops a member who opted out of that kind, and only that kind', async () => {
    await setMailSettings(playerB, { mailReminders: false })
    expect((await teamRecipients(team, 'reminder')).map(r => r.userId)).not.toContain(playerB)
    expect((await teamRecipients(team, 'match-info')).map(r => r.userId)).toContain(playerB)
    await setMailSettings(playerB, { mailReminders: true })
  })
})

describe('F16 dispatcher', () => {
  it('mails the whole team one reminder and never a second one', async () => {
    const session = await createOneOffSession(admin, team, {
      date: DAY, startTime: AT, endTime: '20:30', locationId
    })
    const now = new Date(START.getTime() - 20 * 3600_000)
    const before = sentMails.length
    const first = await dispatchDueNotifications(now)
    expect(first.reminder).toBe(4) // playerA, playerB, parentA, coach
    const mails = mailsSince(before)
    expect(mails.every(m => m.subject.includes('training MO17-4'))).toBe(true)
    expect(mails.map(m => m.to).sort()).toEqual(['a@x.nl', 'b@x.nl', 'coach@x.nl', 'parent@x.nl'])

    const second = await dispatchDueNotifications(now)
    expect(second.reminder).toBe(0)
    expect(sentMails.length).toBe(before + 4)
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })

  it('sends match info for a match instead of a training reminder', async () => {
    const match = await createMatch(admin, team, {
      date: '2027-03-18', startTime: '14:30', opponent: 'DVO', homeAway: 'home', locationId
    })
    const now = new Date(sessionStart('2027-03-18', '14:30').getTime() - 40 * 3600_000)
    const before = sentMails.length
    const res = await dispatchDueNotifications(now)
    expect(res['match-info']).toBe(4)
    expect(res.reminder).toBe(0)
    expect(mailsSince(before).every(m => m.subject.includes('MO17-4 - DVO'))).toBe(true)
    await updateSession(admin, match.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })

  it('nudges only about players who have not reported, and skips their parents too', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-04-08', startTime: '19:00', endTime: '20:30', locationId
    })
    const start = sessionStart('2027-04-08', '19:00')
    await reportAbsence(playerA, session.id, playerA, { reason: 'blessure', at: new Date(start.getTime() - 6 * 3600_000) })

    const before = sentMails.length
    const res = await dispatchDueNotifications(new Date(start.getTime() - 3 * 3600_000))
    const nudges = mailsSince(before).filter(m => m.subject.includes('vanavond'))
    expect(res['absence-nudge']).toBe(1)
    // Only player B: A reported, A's parent is about A, and the coach is nobody's player.
    expect(nudges.map(m => m.to)).toEqual(['b@x.nl'])
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })

  it('sends nothing for a cancelled session', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-05-06', startTime: '19:00', endTime: '20:30', locationId
    })
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'veld dicht' })
    const before = sentMails.length
    const res = await dispatchDueNotifications(new Date(sessionStart('2027-05-06', '19:00').getTime() - 2 * 3600_000))
    expect(res.reminder + res['absence-nudge'] + res['match-info']).toBe(0)
    expect(sentMails.length).toBe(before)
  })

  it('respects an opt-out at dispatch time', async () => {
    await setMailSettings(coach, { mailReminders: false })
    const session = await createOneOffSession(admin, team, {
      date: '2027-05-20', startTime: '19:00', endTime: '20:30', locationId
    })
    const before = sentMails.length
    const res = await dispatchDueNotifications(new Date(sessionStart('2027-05-20', '19:00').getTime() - 20 * 3600_000))
    expect(res.reminder).toBe(3)
    expect(mailsSince(before).map(m => m.to)).not.toContain('coach@x.nl')
    await setMailSettings(coach, { mailReminders: true })
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })
})

describe('F16 change and cancellation notices', () => {
  it('mails the team when a session is cancelled, with the reason', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-06-03', startTime: '19:00', endTime: '20:30', locationId
    })
    const before = sentMails.length
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'onweer' })
    const mails = mailsSince(before)
    expect(mails).toHaveLength(4)
    expect(mails[0]!.subject).toContain('afgelast')
    expect(mails[0]!.text).toContain('onweer')
  })

  it('mails when it goes ahead after all', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-06-10', startTime: '19:00', endTime: '20:30', locationId
    })
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'onweer' })
    const before = sentMails.length
    await updateSession(admin, session.id, { status: 'scheduled' })
    expect(mailsSince(before)[0]!.subject).toContain('gaat toch door')
  })

  it('mails a moved session listing what changed', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-06-17', startTime: '19:00', endTime: '20:30', locationId
    })
    const before = sentMails.length
    await updateSession(admin, session.id, { date: '2027-06-18', startTime: '18:00' })
    const mail = mailsSince(before)[0]!
    expect(mail.subject).toContain('gewijzigd')
    expect(mail.text).toContain('Datum')
    expect(mail.text).toContain('18:00')
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })

  it('stays quiet when the update changes nothing a member would notice', async () => {
    const session = await createOneOffSession(admin, team, {
      date: '2027-06-24', startTime: '19:00', endTime: '20:30', locationId
    })
    const before = sentMails.length
    await updateSession(admin, session.id, { trainerUserId: coach })
    expect(sentMails.length).toBe(before)
    await updateSession(admin, session.id, { status: 'cancelled', cancelReason: 'opruimen' })
  })

  it('mails every team affected by a club closure that wiped out trainings', async () => {
    const s1 = await createOneOffSession(admin, team, {
      date: '2027-02-10', startTime: '19:00', endTime: '20:30', locationId
    })
    const s2 = await createOneOffSession(admin, team, {
      date: '2027-02-12', startTime: '19:00', endTime: '20:30', locationId
    })
    const before = sentMails.length
    const res = await createNoTrainingPeriod(admin, {
      startDate: '2027-02-08', endDate: '2027-02-14', reason: 'voorjaarsvakantie'
    })
    expect(res.cancelledSessions).toBe(2)
    const mails = mailsSince(before)
    expect(mails).toHaveLength(8) // 2 sessions x 4 recipients
    expect(mails.every(m => m.text.includes('voorjaarsvakantie'))).toBe(true)
    expect([s1.id, s2.id]).toHaveLength(2)
  })
})

describe('F16 mail settings', () => {
  it('persists each flag independently and leaves the others alone', async () => {
    const updated = await setMailSettings(playerA, { mailAbsenceNudges: false })
    expect(updated.mailAbsenceNudges).toBe(false)
    expect(updated.mailReminders).toBe(true)
    expect(updated.mailChanges).toBe(true)
    expect(updated.mailMatchInfo).toBe(true)
    await setMailSettings(playerA, { mailAbsenceNudges: true })
  })
})
