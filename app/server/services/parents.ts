import { createError } from 'h3'
import { eq, or, and } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isParentOf } from '../utils/roles'
import { canSelfManageAttendance, canParentManageAttendance } from '../utils/age-rules'
import { sendMail } from '../utils/mailer'
import { getCurrentClub } from './clubs'
import { user, parentLinks } from '../db/schema'

async function getUserOr404(userId: string) {
  const db = getDb()
  const [found] = await db.select().from(user).where(eq(user.id, userId))
  if (!found) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return found
}

/**
 * Request a parent-player link (F5). Works in both directions:
 * - otherRole 'parent': the requester is the player, entering their parent's email;
 * - otherRole 'player': the requester is the parent, entering their player's email.
 * The other party gets a confirmation mail and must acknowledge before the link is active.
 */
export async function requestParentLink(requesterId: string, otherEmail: string, otherRole: 'parent' | 'player') {
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'No club exists yet' })
  const db = getDb()
  const email = otherEmail.trim().toLowerCase()
  const [other] = await db.select().from(user).where(eq(user.email, email))
  if (!other) throw createError({ statusCode: 404, statusMessage: 'No registered account with this email' })
  if (other.id === requesterId) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot link to yourself' })
  }
  const parentUserId = otherRole === 'parent' ? other.id : requesterId
  const playerUserId = otherRole === 'parent' ? requesterId : other.id
  const existing = await db.select({ id: parentLinks.id }).from(parentLinks)
    .where(and(eq(parentLinks.parentUserId, parentUserId), eq(parentLinks.playerUserId, playerUserId)))
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'This link already exists (pending or active)' })
  }
  const requester = await getUserOr404(requesterId)
  const [link] = await db.insert(parentLinks).values({
    clubId: club.id,
    parentUserId,
    playerUserId,
    requestedBy: otherRole === 'parent' ? 'player' : 'parent'
  }).returning()
  const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
  const relation = otherRole === 'parent'
    ? `${requester.name} heeft je opgegeven als ouder/verzorger`
    : `${requester.name} heeft je opgegeven als hun kind (speler)`
  await sendMail({
    to: other.email,
    subject: 'teamplanner - bevestig ouder-speler koppeling',
    text: `${relation} op teamplanner.\n\nBevestig de koppeling via deze link:\n${baseUrl}/confirm-parent-link?token=${link!.token}\n\nKlopt dit niet? Negeer deze mail.`
  })
  return link!
}

/** Confirm a pending link by token. Only the RECEIVING party (not the requester) may confirm. */
export async function confirmParentLink(userId: string, token: string) {
  const db = getDb()
  const [link] = await db.select().from(parentLinks).where(eq(parentLinks.token, token))
  if (!link || link.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'Link request not found or already confirmed' })
  }
  const receiverId = link.requestedBy === 'player' ? link.parentUserId : link.playerUserId
  if (userId !== receiverId) {
    throw createError({ statusCode: 403, statusMessage: 'This confirmation is addressed to the other party' })
  }
  const [updated] = await db.update(parentLinks)
    .set({ status: 'active' })
    .where(eq(parentLinks.id, link.id))
    .returning()
  return updated!
}

/** Remove (or reject) a link. Allowed for either party or a club admin. */
export async function removeParentLink(requesterId: string, linkId: string) {
  const db = getDb()
  const [link] = await db.select().from(parentLinks).where(eq(parentLinks.id, linkId))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Link not found' })
  if (requesterId !== link.parentUserId && requesterId !== link.playerUserId) {
    const roles = await getUserRoles(requesterId)
    if (!isClubAdmin(roles, link.clubId)) {
      throw createError({ statusCode: 403, statusMessage: 'Only the linked parties or an admin can remove this link' })
    }
  }
  await db.delete(parentLinks).where(eq(parentLinks.id, linkId))
  return { removed: true }
}

/** All links where the user is parent or player, with the other party's details. */
export async function listParentLinks(userId: string) {
  const db = getDb()
  const parentUser = alias(user, 'parent_user')
  const playerUser = alias(user, 'player_user')
  const rows = await db.select({
    id: parentLinks.id,
    status: parentLinks.status,
    requestedBy: parentLinks.requestedBy,
    parentUserId: parentLinks.parentUserId,
    playerUserId: parentLinks.playerUserId,
    parentName: parentUser.name,
    parentEmail: parentUser.email,
    playerName: playerUser.name,
    playerEmail: playerUser.email,
    playerDateOfBirth: playerUser.dateOfBirth,
    playerSelfManageOptIn: playerUser.selfManageOptIn,
    playerParentManageOptIn: playerUser.parentManageOptIn
  }).from(parentLinks)
    .innerJoin(parentUser, eq(parentLinks.parentUserId, parentUser.id))
    .innerJoin(playerUser, eq(parentLinks.playerUserId, playerUser.id))
    .where(or(eq(parentLinks.parentUserId, userId), eq(parentLinks.playerUserId, userId)))
  return rows.map((r) => {
    const myRole = r.parentUserId === userId ? 'parent' as const : 'player' as const
    return {
      id: r.id,
      status: r.status,
      myRole,
      requestedByMe: r.requestedBy === myRole,
      other: myRole === 'parent'
        ? { id: r.playerUserId, name: r.playerName, email: r.playerEmail }
        : { id: r.parentUserId, name: r.parentName, email: r.parentEmail },
      // Parent-side management context (only meaningful when I'm the parent and the link is active):
      player: {
        dateOfBirth: r.playerDateOfBirth,
        selfManageOptIn: r.playerSelfManageOptIn,
        parentManageOptIn: r.playerParentManageOptIn,
        parentMayManage: r.status === 'active'
          && canParentManageAttendance(r.playerDateOfBirth, r.playerParentManageOptIn)
      }
    }
  })
}

/**
 * F5 under-15 checkmark: enable/disable a player's attendance self-management.
 * Set by an ACTIVE linked parent or a club admin - not by the child themself.
 */
export async function setSelfManageOptIn(requesterId: string, playerUserId: string, enabled: boolean) {
  const target = await getUserOr404(playerUserId)
  const roles = await getUserRoles(requesterId)
  const club = await getCurrentClub()
  const admin = club ? isClubAdmin(roles, club.id) : false
  if (!isParentOf(roles, playerUserId) && !admin) {
    throw createError({ statusCode: 403, statusMessage: 'Only a linked parent or an admin can change this setting' })
  }
  const db = getDb()
  const [updated] = await db.update(user)
    .set({ selfManageOptIn: enabled, updatedAt: new Date() })
    .where(eq(user.id, target.id))
    .returning()
  return { userId: updated!.id, selfManageOptIn: updated!.selfManageOptIn }
}

/** F5 18+ setting "mijn ouder mag mijn aanwezigheid beheren" - owned by the player themself. */
export async function setParentManageOptIn(requesterId: string, enabled: boolean) {
  const db = getDb()
  const [updated] = await db.update(user)
    .set({ parentManageOptIn: enabled, updatedAt: new Date() })
    .where(eq(user.id, requesterId))
    .returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return { userId: updated.id, parentManageOptIn: updated.parentManageOptIn }
}

/**
 * May `actorId` manage attendance (report absence etc.) for `playerUserId`? (Used by F13.)
 * - the player themself: age rules (15+, or under-15 with opt-in);
 * - an ACTIVE linked parent: until 18, or 18+ with the player's opt-in;
 * - everyone else: no (staff corrections get their own F13 rules).
 */
export async function canManageAttendanceFor(actorId: string, playerUserId: string): Promise<boolean> {
  const player = await getUserOr404(playerUserId)
  if (actorId === playerUserId) {
    return canSelfManageAttendance(player.dateOfBirth, player.selfManageOptIn)
  }
  const roles = await getUserRoles(actorId)
  if (isParentOf(roles, playerUserId)) {
    return canParentManageAttendance(player.dateOfBirth, player.parentManageOptIn)
  }
  return false
}
