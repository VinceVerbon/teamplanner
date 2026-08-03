import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isActiveStaffOfTeam } from '../utils/roles'
import { assertPasswordAllowed } from '../utils/password-policy'
import { sendMail } from '../utils/mailer'
import { user, account, teams, clubs, invitations, staffAssignments, playerRegistrations } from '../db/schema'

const INVITATION_TTL_DAYS = 14
const CREDENTIAL_PROVIDER = 'credential'

async function getTeamOr404(teamId: string) {
  const db = getDb()
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  return team
}

async function findUserByEmail(email: string) {
  const db = getDb()
  const [found] = await db.select({ id: user.id, email: user.email, dateOfBirth: user.dateOfBirth })
    .from(user).where(eq(user.email, email.trim().toLowerCase()))
  return found ?? null
}

function isExpired(invite: { expiresAt: Date }): boolean {
  return invite.expiresAt.getTime() <= Date.now()
}

function formatDateNl(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

/** Public shape - the token NEVER leaves the service towards the requester. */
function sanitize(invite: typeof invitations.$inferSelect) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    teamId: invite.teamId,
    status: invite.status,
    expiresAt: invite.expiresAt,
    expired: invite.status === 'pending' && isExpired(invite)
  }
}

/**
 * F9: invite an UNREGISTERED email to register and land in the right team/role.
 * - role 'player': admin only (mirrors F8 assignPlayer);
 * - role 'staff': admin -> assignment becomes 'active' on accept; active team staff ->
 *   'pending' until an admin verifies (F8 semantics, snapshotted at invite time).
 * Registered identities are refused: the existing F8 assignment flows cover them.
 */
export async function createInvitation(requesterId: string, teamId: string, rawEmail: string, role: 'player' | 'staff') {
  const team = await getTeamOr404(teamId)
  const roles = await getUserRoles(requesterId)
  const admin = isClubAdmin(roles, team.clubId)
  if (role === 'player' && !admin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (role === 'staff' && !admin && !isActiveStaffOfTeam(roles, teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
  }
  const email = rawEmail.trim().toLowerCase()
  if (await findUserByEmail(email)) {
    throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists; assign them via team management instead' })
  }
  const db = getDb()
  const pending = await db.select().from(invitations)
    .where(and(eq(invitations.teamId, teamId), eq(invitations.email, email), eq(invitations.status, 'pending')))
  const open = pending.filter(i => !isExpired(i))
  if (open.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'A pending invitation for this email and team already exists' })
  }
  // A stale expired invite for the same team+email is superseded by the new one.
  for (const stale of pending) {
    await db.update(invitations).set({ status: 'cancelled' }).where(eq(invitations.id, stale.id))
  }
  const [inviter] = await db.select({ name: user.name }).from(user).where(eq(user.id, requesterId))
  const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, team.clubId))
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const [invite] = await db.insert(invitations).values({
    clubId: team.clubId,
    teamId,
    email,
    role,
    staffStatus: role === 'staff' ? (admin ? 'active' : 'pending') : null,
    invitedByUserId: requesterId,
    expiresAt
  }).returning()
  const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
  const roleText = role === 'player' ? 'speler' : 'staflid'
  await sendMail({
    to: email,
    subject: `teamplanner - uitnodiging voor ${team.name}`,
    text: `${inviter?.name ?? 'Een beheerder'} nodigt je uit als ${roleText} van ${team.name}`
      + `${club ? ` (${club.name})` : ''} op teamplanner.\n\n`
      + `Maak je account aan en accepteer de uitnodiging via deze link:\n`
      + `${baseUrl}/accept-invite?token=${invite!.token}\n\n`
      + `Deze uitnodiging is geldig tot ${formatDateNl(expiresAt)}.\n\n`
      + `Verwacht je deze uitnodiging niet? Negeer deze mail.`
  })
  return sanitize(invite!)
}

/**
 * Pending invitations, club-wide (admin only) or for one team (admin or active team
 * staff). Expired ones are included and flagged so they can still be cancelled.
 */
export async function listInvitations(requesterId: string, teamId?: string) {
  const db = getDb()
  const roles = await getUserRoles(requesterId)
  let where
  if (teamId) {
    const team = await getTeamOr404(teamId)
    if (!isClubAdmin(roles, team.clubId) && !isActiveStaffOfTeam(roles, teamId)) {
      throw createError({ statusCode: 403, statusMessage: 'Admin or active team staff role required' })
    }
    where = and(eq(invitations.teamId, teamId), eq(invitations.status, 'pending'))
  } else {
    const [club] = await db.select({ id: clubs.id }).from(clubs).limit(1)
    if (!club || !isClubAdmin(roles, club.id)) {
      throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
    }
    where = and(eq(invitations.clubId, club.id), eq(invitations.status, 'pending'))
  }
  const rows = await db.select({
    invite: invitations,
    teamName: teams.name,
    inviterName: user.name
  }).from(invitations)
    .innerJoin(teams, eq(invitations.teamId, teams.id))
    .leftJoin(user, eq(invitations.invitedByUserId, user.id))
    .where(where)
    .orderBy(invitations.createdAt)
  return rows.map(r => ({ ...sanitize(r.invite), teamName: r.teamName, inviterName: r.inviterName }))
}

/** Cancel a pending invitation - allowed for a club admin or the original inviter. */
export async function cancelInvitation(requesterId: string, invitationId: string) {
  const db = getDb()
  const [invite] = await db.select().from(invitations).where(eq(invitations.id, invitationId))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  if (invite.invitedByUserId !== requesterId) {
    const roles = await getUserRoles(requesterId)
    if (!isClubAdmin(roles, invite.clubId)) {
      throw createError({ statusCode: 403, statusMessage: 'Only the inviter or an admin can cancel this invitation' })
    }
  }
  if (invite.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Only pending invitations can be cancelled' })
  }
  await db.update(invitations).set({ status: 'cancelled' }).where(eq(invitations.id, invite.id))
  return { cancelled: true }
}

/**
 * Public (token = the secret): what the accept page needs to render. Unknown tokens
 * are a plain 404; every other state is returned so the page can explain it.
 */
export async function lookupInvitation(token: string) {
  const db = getDb()
  const [invite] = await db.select().from(invitations).where(eq(invitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, invite.teamId))
  const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, invite.clubId))
  const status = invite.status === 'pending' && isExpired(invite) ? 'expired' as const : invite.status
  return {
    status,
    email: invite.email,
    role: invite.role,
    teamName: team?.name ?? null,
    clubName: club?.name ?? null,
    expiresAt: invite.expiresAt,
    accountExists: !!(await findUserByEmail(invite.email))
  }
}

/** The invite behind the token, only if it is still acceptable. */
async function getAcceptableInviteOr404(token: string) {
  const db = getDb()
  const [invite] = await db.select().from(invitations).where(eq(invitations.token, token))
  if (!invite || invite.status === 'cancelled') {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found or no longer valid' })
  }
  if (invite.status === 'accepted') {
    throw createError({ statusCode: 409, statusMessage: 'Invitation already accepted' })
  }
  if (isExpired(invite)) {
    throw createError({ statusCode: 410, statusMessage: 'Invitation expired' })
  }
  return invite
}

/** Materialize the invited role for userId, then mark the invite accepted. */
async function applyInvitation(invite: typeof invitations.$inferSelect, userId: string) {
  const db = getDb()
  if (invite.role === 'player') {
    const [target] = await db.select({ dateOfBirth: user.dateOfBirth }).from(user).where(eq(user.id, userId))
    // DOB is required for players: it drives the F5 age rules (same rule as assignPlayer).
    if (!target?.dateOfBirth) {
      throw createError({ statusCode: 400, statusMessage: 'This account has no date of birth; players must set one first (account settings)' })
    }
    const existing = await db.select().from(playerRegistrations).where(eq(playerRegistrations.userId, userId))
    if (existing.length > 0) {
      throw createError({ statusCode: 409, statusMessage: 'This person is already registered as player with a team' })
    }
    await db.insert(playerRegistrations).values({ clubId: invite.clubId, teamId: invite.teamId, userId })
  } else {
    const existing = await db.select().from(staffAssignments)
      .where(and(eq(staffAssignments.teamId, invite.teamId), eq(staffAssignments.userId, userId)))
    if (existing.length > 0) {
      throw createError({ statusCode: 409, statusMessage: 'Already assigned as staff on this team' })
    }
    await db.insert(staffAssignments).values({
      clubId: invite.clubId,
      teamId: invite.teamId,
      userId,
      status: invite.staffStatus ?? 'pending'
    })
  }
  await db.update(invitations)
    .set({ status: 'accepted', acceptedByUserId: userId, acceptedAt: new Date() })
    .where(eq(invitations.id, invite.id))
}

/** Accept while logged in: only the account the invitation is addressed to may accept. */
export async function acceptInvitationAsUser(userId: string, token: string) {
  const invite = await getAcceptableInviteOr404(token)
  const db = getDb()
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  if (!me || me.email !== invite.email) {
    throw createError({ statusCode: 403, statusMessage: 'This invitation is addressed to a different email address' })
  }
  await applyInvitation(invite, userId)
  return { accepted: true, role: invite.role, teamId: invite.teamId }
}

export interface InviteRegistrationInput {
  name: string
  password: string
  dateOfBirth?: string | null
}

/**
 * Accept by registering in place. The token arrived on the invited address, so the
 * account counts as email-verified (same reasoning as F23 admin-created accounts).
 * The F24 password policy applies like on every other password-setting path.
 */
export async function acceptInvitationWithRegistration(token: string, input: InviteRegistrationInput) {
  const invite = await getAcceptableInviteOr404(token)
  if (await findUserByEmail(invite.email)) {
    throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists; sign in to accept the invitation' })
  }
  const name = input.name.trim()
  if (name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Name too short' })
  }
  if (invite.role === 'player' && !input.dateOfBirth) {
    throw createError({ statusCode: 400, statusMessage: 'Date of birth is required for players' })
  }
  await assertPasswordAllowed(input.password)
  const db = getDb()
  const [created] = await db.insert(user).values({
    name,
    email: invite.email,
    emailVerified: true,
    dateOfBirth: input.dateOfBirth ?? null
  }).returning()
  await db.insert(account).values({
    accountId: created!.id,
    providerId: CREDENTIAL_PROVIDER,
    userId: created!.id,
    password: await hashPassword(input.password)
  })
  await applyInvitation(invite, created!.id)
  return { accepted: true, role: invite.role, teamId: invite.teamId, email: created!.email }
}
