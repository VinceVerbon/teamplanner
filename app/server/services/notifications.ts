// F16 automated team email.
//
// Two delivery paths, deliberately different:
//  - TIME-BASED (reminder / match-info / absence-nudge) run from dispatchDueNotifications,
//    which is idempotent through the sent_notifications ledger. Safe to call on a timer,
//    on startup, or twice in a row.
//  - EVENT-DRIVEN (cancellation / change / reinstated) fire from the service that made
//    the change. They are NOT ledgered: a second real change must mail again.
//
// Every recipient is filtered on their own opt-out column first, so a member who opted
// out of a kind is never queried for, never mailed, and never ledgered.

import { eq, and, inArray, gte, lte } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { sendMail } from '../utils/mailer'
import {
  teams, locations, trainingSessions, staffAssignments, playerRegistrations,
  parentLinks, absences, sentNotifications, user
} from '../db/schema'
import {
  dueKinds, buildReminderMail, buildMatchInfoMail, buildAbsenceNudgeMail,
  buildCancellationMail, buildChangeMail, buildReinstatedMail, describeChanges,
  OPT_OUT_COLUMN, LEAD_HOURS,
  type NotificationKind, type NotifiableSession
} from '../utils/notification-rules'

export function baseUrl(): string {
  return process.env.BETTER_AUTH_URL || 'http://localhost:3000'
}

function scheduleUrl(): string {
  return `${baseUrl()}/schedule`
}

export interface Recipient {
  userId: string
  name: string
  email: string
  // The player this recipient is being mailed ABOUT: themself, or the child they manage.
  aboutPlayerId: string | null
  aboutPlayerName: string | null
}

/**
 * Everyone concerned with a team: its players, the active parents of those players, and
 * its active staff. `kind` selects the opt-out column, so opted-out members drop out here.
 * Staff appear once with no `aboutPlayerId`; a parent of two players in one team appears
 * once per child (each child is a separate nudge subject).
 */
export async function teamRecipients(teamId: string, kind: NotificationKind): Promise<Recipient[]> {
  const db = getDb()
  const optOut = OPT_OUT_COLUMN[kind]
  const out: Recipient[] = []

  const players = await db.select({ userId: user.id, name: user.name, email: user.email })
    .from(playerRegistrations)
    .innerJoin(user, eq(user.id, playerRegistrations.userId))
    .where(and(eq(playerRegistrations.teamId, teamId), eq(user[optOut], true)))
  for (const p of players) out.push({ ...p, aboutPlayerId: p.userId, aboutPlayerName: p.name })

  // Parents are mailed about their child, so the query starts from the team's players
  // (all of them - a parent may be opted in while the child opted out).
  const allPlayerIds = (await db.select({ userId: playerRegistrations.userId })
    .from(playerRegistrations).where(eq(playerRegistrations.teamId, teamId))).map(r => r.userId)
  if (allPlayerIds.length) {
    const parents = await db.select({
      userId: user.id, name: user.name, email: user.email, childId: parentLinks.playerUserId
    })
      .from(parentLinks)
      .innerJoin(user, eq(user.id, parentLinks.parentUserId))
      .where(and(
        inArray(parentLinks.playerUserId, allPlayerIds),
        eq(parentLinks.status, 'active'),
        eq(user[optOut], true)
      ))
    const childNames = new Map((await db.select({ id: user.id, name: user.name })
      .from(user).where(inArray(user.id, allPlayerIds))).map(r => [r.id, r.name]))
    for (const p of parents) {
      out.push({
        userId: p.userId, name: p.name, email: p.email,
        aboutPlayerId: p.childId, aboutPlayerName: childNames.get(p.childId) ?? 'je kind'
      })
    }
  }

  const staff = await db.select({ userId: user.id, name: user.name, email: user.email })
    .from(staffAssignments)
    .innerJoin(user, eq(user.id, staffAssignments.userId))
    .where(and(
      eq(staffAssignments.teamId, teamId),
      eq(staffAssignments.status, 'active'),
      eq(user[optOut], true)
    ))
  for (const s of staff) {
    // A player-coach is already in as a player; keep the player entry (it carries the
    // absence subject) rather than mailing the same person twice.
    if (!out.some(r => r.userId === s.userId)) {
      out.push({ ...s, aboutPlayerId: null, aboutPlayerName: null })
    }
  }
  return out
}

async function loadNotifiable(sessionId: string): Promise<{ session: NotifiableSession, teamName: string, clubId: string } | null> {
  const db = getDb()
  const [row] = await db.select({
    id: trainingSessions.id,
    clubId: trainingSessions.clubId,
    teamId: trainingSessions.teamId,
    type: trainingSessions.type,
    date: trainingSessions.date,
    startTime: trainingSessions.startTime,
    endTime: trainingSessions.endTime,
    status: trainingSessions.status,
    opponent: trainingSessions.opponent,
    homeAway: trainingSessions.homeAway,
    locationText: trainingSessions.locationText,
    locationName: locations.name,
    teamName: teams.name
  })
    .from(trainingSessions)
    .innerJoin(teams, eq(teams.id, trainingSessions.teamId))
    .leftJoin(locations, eq(locations.id, trainingSessions.locationId))
    .where(eq(trainingSessions.id, sessionId))
  if (!row) return null
  return {
    clubId: row.clubId,
    teamName: row.teamName,
    session: {
      id: row.id,
      teamId: row.teamId,
      type: row.type,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      status: row.status,
      opponent: row.opponent,
      homeAway: row.homeAway,
      locationName: row.locationName ?? row.locationText
    }
  }
}

/**
 * Snapshot of a raw training_sessions row as the shape the rules work on, resolving the
 * location name so a location change reads as names rather than ids in the change mail.
 * Callers take this BEFORE they update, and pass it to notifySessionChanged after.
 */
export async function sessionSnapshot(row: {
  id: string
  teamId: string
  type: 'training' | 'match'
  date: string
  startTime: string
  endTime: string | null
  status: 'scheduled' | 'cancelled'
  opponent: string | null
  homeAway: 'home' | 'away' | null
  locationId: string | null
  locationText: string | null
}): Promise<NotifiableSession> {
  let locationName = row.locationText
  if (row.locationId) {
    const [loc] = await getDb().select({ name: locations.name })
      .from(locations).where(eq(locations.id, row.locationId))
    if (loc) locationName = loc.name
  }
  return {
    id: row.id,
    teamId: row.teamId,
    type: row.type,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    opponent: row.opponent,
    homeAway: row.homeAway,
    locationName
  }
}

/**
 * Time-based dispatch. Scans sessions starting inside the widest lead window, works out
 * which kinds are due per session, and mails the recipients that have not been mailed
 * for that (kind, session) yet.
 *
 * Returns per-kind counts so the endpoint and the tests can assert on real work done.
 */
export async function dispatchDueNotifications(now: Date = new Date()): Promise<Record<NotificationKind, number>> {
  const db = getDb()
  const sent: Record<NotificationKind, number> = { 'reminder': 0, 'match-info': 0, 'absence-nudge': 0 }
  const maxLead = Math.max(...Object.values(LEAD_HOURS))
  const from = now.toISOString().slice(0, 10)
  const until = new Date(now.getTime() + maxLead * 3600_000).toISOString().slice(0, 10)

  const candidates = await db.select({
    id: trainingSessions.id,
    clubId: trainingSessions.clubId,
    teamId: trainingSessions.teamId,
    type: trainingSessions.type,
    date: trainingSessions.date,
    startTime: trainingSessions.startTime,
    endTime: trainingSessions.endTime,
    status: trainingSessions.status,
    opponent: trainingSessions.opponent,
    homeAway: trainingSessions.homeAway,
    locationText: trainingSessions.locationText,
    locationName: locations.name,
    teamName: teams.name
  })
    .from(trainingSessions)
    .innerJoin(teams, eq(teams.id, trainingSessions.teamId))
    .leftJoin(locations, eq(locations.id, trainingSessions.locationId))
    .where(and(
      eq(trainingSessions.status, 'scheduled'),
      gte(trainingSessions.date, from),
      lte(trainingSessions.date, until)
    ))

  for (const row of candidates) {
    const session: NotifiableSession = {
      id: row.id,
      teamId: row.teamId,
      type: row.type,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      status: row.status,
      opponent: row.opponent,
      homeAway: row.homeAway,
      locationName: row.locationName ?? row.locationText
    }
    const kinds = dueKinds(session, now)
    if (!kinds.length) continue

    // Players who already reported absence are not nudged - and their parents are not either.
    const reported = new Set((await db.select({ playerUserId: absences.playerUserId })
      .from(absences).where(eq(absences.sessionId, session.id))).map(a => a.playerUserId))

    for (const kind of kinds) {
      const recipients = await teamRecipients(session.teamId, kind)
      const already = new Set((await db.select({ recipientUserId: sentNotifications.recipientUserId })
        .from(sentNotifications)
        .where(and(eq(sentNotifications.kind, kind), eq(sentNotifications.sessionId, session.id))))
        .map(r => r.recipientUserId))

      for (const r of recipients) {
        if (already.has(r.userId)) continue
        if (kind === 'absence-nudge') {
          // Only meaningful for someone attached to a player who has not reported yet.
          if (!r.aboutPlayerId) continue
          if (reported.has(r.aboutPlayerId)) continue
        }
        const mail = kind === 'reminder'
          ? buildReminderMail(session, row.teamName, r.name, scheduleUrl())
          : kind === 'match-info'
            ? buildMatchInfoMail(session, row.teamName, r.name, scheduleUrl())
            : buildAbsenceNudgeMail(session, row.teamName, r.name, r.aboutPlayerName ?? '', r.aboutPlayerId === r.userId, scheduleUrl())

        // Ledger BEFORE sending: a crash mid-send must not produce a duplicate on the
        // next tick. Losing one mail beats mailing a whole team twice.
        await db.insert(sentNotifications).values({
          clubId: row.clubId, kind, sessionId: session.id, recipientUserId: r.userId
        })
        await sendMail({ to: r.email, subject: mail.subject, text: mail.text })
        already.add(r.userId)
        sent[kind]++
      }
    }
  }
  return sent
}

/**
 * Event-driven notice for one session that was just cancelled, changed or reinstated.
 * `before` is the pre-update row; when nothing a member would care about moved, nothing
 * is sent. Never throws into the caller's transaction path - a failing mail must not
 * roll back a legitimate schedule change.
 */
export async function notifySessionChanged(sessionId: string, before: NotifiableSession): Promise<number> {
  try {
    const loaded = await loadNotifiable(sessionId)
    if (!loaded) return 0
    const { session, teamName } = loaded
    const cancelled = before.status === 'scheduled' && session.status === 'cancelled'
    const reinstated = before.status === 'cancelled' && session.status === 'scheduled'
    const changes = describeChanges(before, session)
    if (!cancelled && !reinstated && !changes.length) return 0
    // A cancelled session that merely moved is still just cancelled - one mail, not two.
    const recipients = await teamRecipientsForChanges(session.teamId)
    const reason = cancelled ? (await cancelReasonOf(sessionId)) ?? 'geen reden opgegeven' : ''
    let count = 0
    for (const r of recipients) {
      const mail = cancelled
        ? buildCancellationMail(session, teamName, r.name, reason, scheduleUrl())
        : reinstated
          ? buildReinstatedMail(session, teamName, r.name, scheduleUrl())
          : buildChangeMail(session, teamName, r.name, changes, scheduleUrl())
      await sendMail({ to: r.email, subject: mail.subject, text: mail.text })
      count++
    }
    return count
  } catch (err) {
    console.error('[teamplanner] change notification failed', err)
    return 0
  }
}

async function cancelReasonOf(sessionId: string): Promise<string | null> {
  const [row] = await getDb().select({ reason: trainingSessions.cancelReason })
    .from(trainingSessions).where(eq(trainingSessions.id, sessionId))
  return row?.reason ?? null
}

// Change notices use their own opt-out column (mailChanges).
export async function teamRecipientsForChanges(teamId: string): Promise<Recipient[]> {
  const db = getDb()
  const out: Recipient[] = []
  const players = await db.select({ userId: user.id, name: user.name, email: user.email })
    .from(playerRegistrations)
    .innerJoin(user, eq(user.id, playerRegistrations.userId))
    .where(and(eq(playerRegistrations.teamId, teamId), eq(user.mailChanges, true)))
  for (const p of players) out.push({ ...p, aboutPlayerId: p.userId, aboutPlayerName: p.name })

  const allPlayerIds = (await db.select({ userId: playerRegistrations.userId })
    .from(playerRegistrations).where(eq(playerRegistrations.teamId, teamId))).map(r => r.userId)
  if (allPlayerIds.length) {
    const parents = await db.select({ userId: user.id, name: user.name, email: user.email })
      .from(parentLinks)
      .innerJoin(user, eq(user.id, parentLinks.parentUserId))
      .where(and(
        inArray(parentLinks.playerUserId, allPlayerIds),
        eq(parentLinks.status, 'active'),
        eq(user.mailChanges, true)
      ))
    for (const p of parents) {
      if (!out.some(r => r.userId === p.userId)) out.push({ ...p, aboutPlayerId: null, aboutPlayerName: null })
    }
  }
  const staff = await db.select({ userId: user.id, name: user.name, email: user.email })
    .from(staffAssignments)
    .innerJoin(user, eq(user.id, staffAssignments.userId))
    .where(and(
      eq(staffAssignments.teamId, teamId),
      eq(staffAssignments.status, 'active'),
      eq(user.mailChanges, true)
    ))
  for (const s of staff) {
    if (!out.some(r => r.userId === s.userId)) out.push({ ...s, aboutPlayerId: null, aboutPlayerName: null })
  }
  return out
}

/** Bulk cancellation notice for a club/team closure (F10) that cancelled many sessions. */
export async function notifySessionsCancelled(sessionIds: string[], reason: string): Promise<number> {
  let count = 0
  for (const sessionId of sessionIds) {
    try {
      const loaded = await loadNotifiable(sessionId)
      if (!loaded) continue
      const { session, teamName } = loaded
      for (const r of await teamRecipientsForChanges(session.teamId)) {
        const mail = buildCancellationMail(session, teamName, r.name, reason, scheduleUrl())
        await sendMail({ to: r.email, subject: mail.subject, text: mail.text })
        count++
      }
    } catch (err) {
      console.error('[teamplanner] bulk cancellation notification failed', err)
    }
  }
  return count
}

/** Per-member opt-out settings (F16). */
export async function setMailSettings(userId: string, patch: {
  mailReminders?: boolean
  mailChanges?: boolean
  mailAbsenceNudges?: boolean
  mailMatchInfo?: boolean
}) {
  const db = getDb()
  const next: Record<string, boolean> = {}
  if (patch.mailReminders !== undefined) next.mailReminders = patch.mailReminders
  if (patch.mailChanges !== undefined) next.mailChanges = patch.mailChanges
  if (patch.mailAbsenceNudges !== undefined) next.mailAbsenceNudges = patch.mailAbsenceNudges
  if (patch.mailMatchInfo !== undefined) next.mailMatchInfo = patch.mailMatchInfo
  const [updated] = await db.update(user).set(next).where(eq(user.id, userId)).returning()
  return {
    mailReminders: updated!.mailReminders,
    mailChanges: updated!.mailChanges,
    mailAbsenceNudges: updated!.mailAbsenceNudges,
    mailMatchInfo: updated!.mailMatchInfo
  }
}
