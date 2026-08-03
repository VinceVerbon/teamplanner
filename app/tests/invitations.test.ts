// Test-set for F9 (email invitations) - main flows and expected edge cases.
import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { sentMails } from '../server/utils/mailer'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { addStaff, assignPlayer, listTeamMembers, verifyStaff } from '../server/services/members'
import {
  createInvitation, listInvitations, cancelInvitation, lookupInvitation,
  acceptInvitationAsUser, acceptInvitationWithRegistration
} from '../server/services/invitations'
import { user, invitations, staffAssignments } from '../server/db/schema'

const GOOD_PASSWORD = 'Prima-Wachtwoord-1'

let admin: string
let coach: string
let outsider: string
let clubId: string
let teamA: string
let teamB: string

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: '2009-03-01' }).returning()
  return u!.id
}

/** The token reaches the invitee ONLY via the mailed accept link. */
function mailedToken(to: string): string {
  const mail = [...sentMails].reverse().find(m => m.to === to)
  expect(mail, `expected an invitation mail to ${to}`).toBeTruthy()
  const match = mail!.text.match(/accept-invite\?token=([A-Za-z0-9-]+)/)
  expect(match, 'expected the mail to carry an accept-invite link').toBeTruthy()
  return match![1]!
}

async function expireInvite(token: string) {
  await getDb().update(invitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(invitations.token, token))
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  coach = await makeUser('coach@example.com')
  outsider = await makeUser('outsider@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  teamA = (await createTeam(admin, clubId, 'MO17-4')).id
  teamB = (await createTeam(admin, clubId, 'MO15-2')).id
  await addStaff(admin, teamA, 'coach@example.com')
})

describe('F9 email invitations - main flows', () => {
  it('admin invites a player: mail carries the accept link, response never carries the token', async () => {
    const invite = await createInvitation(admin, teamA, 'Nieuw.Lid@Example.com', 'player')
    expect(invite.email).toBe('nieuw.lid@example.com')
    expect(invite.status).toBe('pending')
    expect(invite).not.toHaveProperty('token')
    const mail = sentMails.find(m => m.to === 'nieuw.lid@example.com')
    expect(mail?.subject).toContain('uitnodiging')
    expect(mail?.text).toContain('/accept-invite?token=')
    expect(mail?.text).toContain('MO17-4')
  })

  it('lookup by token shows what the accept page needs', async () => {
    const token = mailedToken('nieuw.lid@example.com')
    const info = await lookupInvitation(token)
    expect(info).toMatchObject({
      status: 'pending', email: 'nieuw.lid@example.com', role: 'player',
      teamName: 'MO17-4', clubName: 'FC Aalsmeer', accountExists: false
    })
  })

  it('accepting with in-place registration creates a verified account and the player registration', async () => {
    const token = mailedToken('nieuw.lid@example.com')
    const res = await acceptInvitationWithRegistration(token, {
      name: 'Nieuw Lid', password: GOOD_PASSWORD, dateOfBirth: '2010-05-15'
    })
    expect(res).toMatchObject({ accepted: true, role: 'player', teamId: teamA })
    const [created] = await getDb().select().from(user).where(eq(user.email, 'nieuw.lid@example.com'))
    expect(created?.emailVerified).toBe(true)
    expect(created?.mustSetPassword).toBe(false)
    const { players } = await listTeamMembers(admin, teamA)
    expect(players.map(p => p.email)).toContain('nieuw.lid@example.com')
  })

  it('staff invited BY AN ADMIN lands active on accept (F8 semantics)', async () => {
    await createInvitation(admin, teamA, 'trainer2@example.com', 'staff')
    const token = mailedToken('trainer2@example.com')
    await acceptInvitationWithRegistration(token, { name: 'Trainer Twee', password: GOOD_PASSWORD })
    const { staff } = await listTeamMembers(admin, teamA)
    const row = staff.find(s => s.email === 'trainer2@example.com')
    expect(row?.status).toBe('active')
  })

  it('staff invited BY TEAM STAFF lands pending until an admin verifies (F8 semantics)', async () => {
    await createInvitation(coach, teamA, 'trainer3@example.com', 'staff')
    const token = mailedToken('trainer3@example.com')
    await acceptInvitationWithRegistration(token, { name: 'Trainer Drie', password: GOOD_PASSWORD })
    const { staff } = await listTeamMembers(admin, teamA)
    const row = staff.find(s => s.email === 'trainer3@example.com')
    expect(row?.status).toBe('pending')
    const verified = await verifyStaff(admin, row!.assignmentId)
    expect(verified.status).toBe('active')
  })

  it('a user who registered after being invited accepts while logged in (matching email)', async () => {
    await createInvitation(admin, teamB, 'zelf.geregistreerd@example.com', 'staff')
    const token = mailedToken('zelf.geregistreerd@example.com')
    const userId = await makeUser('zelf.geregistreerd@example.com')
    const res = await acceptInvitationAsUser(userId, token)
    expect(res).toMatchObject({ accepted: true, role: 'staff', teamId: teamB })
    const [assignment] = await getDb().select().from(staffAssignments)
      .where(eq(staffAssignments.userId, userId))
    expect(assignment?.status).toBe('active')
  })

  it('admin sees the club-wide pending list; team staff sees their team list; both without tokens', async () => {
    await createInvitation(admin, teamA, 'lijst.a@example.com', 'player')
    await createInvitation(admin, teamB, 'lijst.b@example.com', 'staff')
    const clubWide = await listInvitations(admin)
    const emails = clubWide.map(i => i.email)
    expect(emails).toEqual(expect.arrayContaining(['lijst.a@example.com', 'lijst.b@example.com']))
    expect(clubWide.every(i => !('token' in i))).toBe(true)
    expect(clubWide.find(i => i.email === 'lijst.a@example.com')?.teamName).toBe('MO17-4')
    const teamOnly = await listInvitations(coach, teamA)
    expect(teamOnly.map(i => i.email)).toContain('lijst.a@example.com')
    expect(teamOnly.map(i => i.email)).not.toContain('lijst.b@example.com')
  })

  it('the inviter and an admin can cancel; a cancelled invitation is dead', async () => {
    await createInvitation(coach, teamA, 'geannuleerd@example.com', 'staff')
    const [invite] = await listInvitations(coach, teamA)
      .then(list => list.filter(i => i.email === 'geannuleerd@example.com'))
    await cancelInvitation(coach, invite!.id)
    const token = mailedToken('geannuleerd@example.com')
    await expect(acceptInvitationWithRegistration(token, { name: 'Te Laat', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('F9 email invitations - edge cases', () => {
  it('team staff cannot invite players (admin only, mirrors F8)', async () => {
    await expect(createInvitation(coach, teamA, 'speler.x@example.com', 'player'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('an outsider cannot invite staff; staff cannot invite for another team', async () => {
    await expect(createInvitation(outsider, teamA, 'x@example.com', 'staff'))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(createInvitation(coach, teamB, 'y@example.com', 'staff'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('inviting an email that already has an account is a 409 (use the F8 flows)', async () => {
    await expect(createInvitation(admin, teamA, 'coach@example.com', 'staff'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('a second pending invitation for the same team+email is a 409', async () => {
    await createInvitation(admin, teamA, 'dubbel@example.com', 'player')
    await expect(createInvitation(admin, teamA, 'dubbel@example.com', 'player'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('unknown tokens are a 404 on lookup and accept', async () => {
    await expect(lookupInvitation('no-such-token')).rejects.toMatchObject({ statusCode: 404 })
    await expect(acceptInvitationWithRegistration('no-such-token', { name: 'Niemand', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('an expired invitation reports expired on lookup and is a 410 on accept', async () => {
    await createInvitation(admin, teamB, 'verlopen@example.com', 'staff')
    const token = mailedToken('verlopen@example.com')
    await expireInvite(token)
    const info = await lookupInvitation(token)
    expect(info.status).toBe('expired')
    await expect(acceptInvitationWithRegistration(token, { name: 'Verlopen', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 410 })
  })

  it('a new invitation supersedes an expired pending one for the same team+email', async () => {
    const invite = await createInvitation(admin, teamB, 'verlopen@example.com', 'staff')
    expect(invite.status).toBe('pending')
  })

  it('accepting twice is a 409 (already accepted)', async () => {
    await createInvitation(admin, teamB, 'twee.keer@example.com', 'staff')
    const token = mailedToken('twee.keer@example.com')
    await acceptInvitationWithRegistration(token, { name: 'Twee Keer', password: GOOD_PASSWORD })
    await expect(acceptInvitationWithRegistration(token, { name: 'Twee Keer', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('registration accept enforces the F24 password policy', async () => {
    await createInvitation(admin, teamB, 'zwak.ww@example.com', 'staff')
    const token = mailedToken('zwak.ww@example.com')
    await expect(acceptInvitationWithRegistration(token, { name: 'Zwak Wachtwoord', password: 'abcdefgh' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('player registration accept requires a date of birth', async () => {
    await createInvitation(admin, teamB, 'geen.dob@example.com', 'player')
    const token = mailedToken('geen.dob@example.com')
    await expect(acceptInvitationWithRegistration(token, { name: 'Geen Dob', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('registration accept is a 409 when an account meanwhile exists for that email', async () => {
    await createInvitation(admin, teamB, 'tussentijds@example.com', 'staff')
    const token = mailedToken('tussentijds@example.com')
    await makeUser('tussentijds@example.com')
    await expect(acceptInvitationWithRegistration(token, { name: 'Tussentijds', password: GOOD_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('logged-in accept with a different email is a 403 (addressed to someone else)', async () => {
    await createInvitation(admin, teamB, 'voor.ander@example.com', 'staff')
    const token = mailedToken('voor.ander@example.com')
    await expect(acceptInvitationAsUser(outsider, token))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('a player invite cannot be accepted by someone already registered as player elsewhere', async () => {
    await assignPlayer(admin, teamA, 'outsider@example.com')
    await createInvitation(admin, teamB, 'al.speler@example.com', 'player')
    const token = mailedToken('al.speler@example.com')
    const db = getDb()
    // The invitee registered separately and is meanwhile a player on another team.
    await db.update(user).set({ email: 'al.speler@example.com' }).where(eq(user.id, outsider))
    await expect(acceptInvitationAsUser(outsider, token))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('cancelling is denied for uninvolved users and refused on non-pending invitations', async () => {
    await createInvitation(admin, teamB, 'annuleer.mij@example.com', 'staff')
    const list = await listInvitations(admin)
    const invite = list.find(i => i.email === 'annuleer.mij@example.com')!
    await expect(cancelInvitation(coach, invite.id)).rejects.toMatchObject({ statusCode: 403 })
    const token = mailedToken('annuleer.mij@example.com')
    await acceptInvitationWithRegistration(token, { name: 'Annuleer Mij', password: GOOD_PASSWORD })
    await expect(cancelInvitation(admin, invite.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('inviting for a non-existent team is a 404', async () => {
    await expect(createInvitation(admin, 'no-such-team', 'z@example.com', 'staff'))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
