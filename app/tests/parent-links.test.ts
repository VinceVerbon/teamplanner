// Test-set for F5 (parent-player linking + age-based attendance management).
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam } from '../server/services/teams'
import { assignPlayer } from '../server/services/members'
import {
  requestParentLink, confirmParentLink, removeParentLink, listParentLinks,
  setSelfManageOptIn, setParentManageOptIn, canManageAttendanceFor
} from '../server/services/parents'
import { ageOn, canSelfManageAttendance, canParentManageAttendance } from '../server/utils/age-rules'
import { sentMails } from '../server/utils/mailer'
import { user, parentLinks } from '../server/db/schema'
import { eq } from 'drizzle-orm'

let admin: string
let parent1: string
let kid14: string // under 15
let teen16: string // 15-17
let adult19: string // 18+
let outsider: string
let clubId: string
let teamA: string

function dobYearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  d.setDate(d.getDate() - 30) // clearly past the birthday
  return d.toISOString().slice(0, 10)
}

async function makeUser(email: string, dateOfBirth?: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth }).returning()
  return u!.id
}

async function tokenOf(linkId: string): Promise<string> {
  const [row] = await getDb().select({ token: parentLinks.token })
    .from(parentLinks).where(eq(parentLinks.id, linkId))
  return row!.token
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  parent1 = await makeUser('parent1@example.com', dobYearsAgo(45))
  kid14 = await makeUser('kid14@example.com', dobYearsAgo(14))
  teen16 = await makeUser('teen16@example.com', dobYearsAgo(16))
  adult19 = await makeUser('adult19@example.com', dobYearsAgo(19))
  outsider = await makeUser('outsider@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  teamA = (await createTeam(admin, clubId, 'MO17-4')).id
})

describe('F5 age rules (pure functions)', () => {
  it('computes age correctly around the birthday boundary', () => {
    const on = new Date('2026-06-15')
    expect(ageOn('2011-06-15', on)).toBe(15) // 15th birthday today
    expect(ageOn('2011-06-16', on)).toBe(14) // birthday tomorrow
    expect(ageOn('2011-06-14', on)).toBe(15)
  })

  it('self-manage: 15+ always, under 15 only with opt-in', () => {
    const on = new Date('2026-06-15')
    expect(canSelfManageAttendance('2011-06-15', false, on)).toBe(true) // turns 15 today
    expect(canSelfManageAttendance('2012-01-01', false, on)).toBe(false) // 14
    expect(canSelfManageAttendance('2012-01-01', true, on)).toBe(true) // 14 + checkmark
    expect(canSelfManageAttendance(null, false, on)).toBe(true) // no DOB -> adult
  })

  it('parent-manage: under 18 always, 18+ only with the player opt-in', () => {
    const on = new Date('2026-06-15')
    expect(canParentManageAttendance('2009-01-01', false, on)).toBe(true) // 17
    expect(canParentManageAttendance('2008-06-15', false, on)).toBe(false) // turns 18 today
    expect(canParentManageAttendance('2008-06-15', true, on)).toBe(true) // 18 + opt-in
    expect(canParentManageAttendance(null, false, on)).toBe(false) // no DOB -> adult
  })
})

describe('F5 linking - main flows', () => {
  it('player requests a link to their parent; parent receives mail and confirms', async () => {
    const mailsBefore = sentMails.length
    const link = await requestParentLink(kid14, 'parent1@example.com', 'parent')
    expect(link.status).toBe('pending')
    expect(link.parentUserId).toBe(parent1)
    expect(link.playerUserId).toBe(kid14)
    const mail = sentMails[sentMails.length - 1]!
    expect(sentMails.length).toBe(mailsBefore + 1)
    expect(mail.to).toBe('parent1@example.com')
    expect(mail.text).toContain(link.token)

    const confirmed = await confirmParentLink(parent1, link.token)
    expect(confirmed.status).toBe('active')
  })

  it('parent requests a link to their player; player confirms (other direction)', async () => {
    const link = await requestParentLink(parent1, 'teen16@example.com', 'player')
    expect(link.requestedBy).toBe('parent')
    const mail = sentMails[sentMails.length - 1]!
    expect(mail.to).toBe('teen16@example.com')
    const confirmed = await confirmParentLink(teen16, link.token)
    expect(confirmed.status).toBe('active')
  })

  it('lists links from both perspectives with the other party and status', async () => {
    const asParent = await listParentLinks(parent1)
    expect(asParent).toHaveLength(2)
    expect(asParent.every(l => l.myRole === 'parent')).toBe(true)
    expect(asParent.map(l => l.other.email).sort())
      .toEqual(['kid14@example.com', 'teen16@example.com'])

    const asPlayer = await listParentLinks(kid14)
    expect(asPlayer).toHaveLength(1)
    expect(asPlayer[0]!.myRole).toBe('player')
    expect(asPlayer[0]!.other.email).toBe('parent1@example.com')
  })

  it('either party can remove a link (reject flow)', async () => {
    const link = await requestParentLink(adult19, 'parent1@example.com', 'parent')
    const res = await removeParentLink(parent1, link.id) // receiver rejects
    expect(res.removed).toBe(true)
  })
})

describe('F5 linking - edge cases', () => {
  it('unregistered email is a 404 (identity must exist first)', async () => {
    await expect(requestParentLink(kid14, 'ghost@example.com', 'parent'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('linking to yourself is a 400', async () => {
    await expect(requestParentLink(parent1, 'parent1@example.com', 'player'))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('duplicate link request is a 409 (also when the direction is flipped)', async () => {
    await expect(requestParentLink(kid14, 'parent1@example.com', 'parent'))
      .rejects.toMatchObject({ statusCode: 409 })
    await expect(requestParentLink(parent1, 'kid14@example.com', 'player'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('only the receiving party can confirm - not the requester or an outsider', async () => {
    const link = await requestParentLink(adult19, 'parent1@example.com', 'parent')
    await expect(confirmParentLink(adult19, link.token)).rejects.toMatchObject({ statusCode: 403 })
    await expect(confirmParentLink(outsider, link.token)).rejects.toMatchObject({ statusCode: 403 })
    await removeParentLink(adult19, link.id)
  })

  it('confirming an unknown or already-used token is a 404', async () => {
    await expect(confirmParentLink(parent1, 'no-such-token')).rejects.toMatchObject({ statusCode: 404 })
    const activeLinks = await listParentLinks(kid14)
    const usedToken = await tokenOf(activeLinks[0]!.id)
    await expect(confirmParentLink(parent1, usedToken)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('an outsider cannot remove a link between two other people', async () => {
    const links = await listParentLinks(kid14)
    await expect(removeParentLink(outsider, links[0]!.id)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('an admin CAN remove any link', async () => {
    const link = await requestParentLink(adult19, 'parent1@example.com', 'parent')
    const res = await removeParentLink(admin, link.id)
    expect(res.removed).toBe(true)
  })
})

describe('F5 attendance management permissions', () => {
  it('15+ player manages their own attendance; under-15 does not by default', async () => {
    expect(await canManageAttendanceFor(teen16, teen16)).toBe(true)
    expect(await canManageAttendanceFor(kid14, kid14)).toBe(false)
  })

  it('linked parent manages an under-18 player; not an 18+ player by default', async () => {
    expect(await canManageAttendanceFor(parent1, kid14)).toBe(true)
    expect(await canManageAttendanceFor(parent1, teen16)).toBe(true)
    // link adult19 <-> parent1 and confirm
    const link = await requestParentLink(adult19, 'parent1@example.com', 'parent')
    await confirmParentLink(parent1, link.token)
    expect(await canManageAttendanceFor(parent1, adult19)).toBe(false)
  })

  it('18+ player re-enables parent management via their own opt-in', async () => {
    await setParentManageOptIn(adult19, true)
    expect(await canManageAttendanceFor(parent1, adult19)).toBe(true)
    await setParentManageOptIn(adult19, false)
    expect(await canManageAttendanceFor(parent1, adult19)).toBe(false)
  })

  it('under-15 self-management is enabled by the parent (checkmark) - not by the child', async () => {
    await expect(setSelfManageOptIn(kid14, kid14, true)).rejects.toMatchObject({ statusCode: 403 })
    const res = await setSelfManageOptIn(parent1, kid14, true)
    expect(res.selfManageOptIn).toBe(true)
    expect(await canManageAttendanceFor(kid14, kid14)).toBe(true)
    await setSelfManageOptIn(parent1, kid14, false)
    expect(await canManageAttendanceFor(kid14, kid14)).toBe(false)
  })

  it('an admin can also set the under-15 checkmark; an unlinked user cannot', async () => {
    const res = await setSelfManageOptIn(admin, kid14, true)
    expect(res.selfManageOptIn).toBe(true)
    await expect(setSelfManageOptIn(outsider, kid14, false)).rejects.toMatchObject({ statusCode: 403 })
    await setSelfManageOptIn(admin, kid14, false)
  })

  it('a pending (unconfirmed) parent link grants no management rights', async () => {
    const pendingParent = await makeUser('parent2@example.com', dobYearsAgo(40))
    await requestParentLink(kid14, 'parent2@example.com', 'parent')
    expect(await canManageAttendanceFor(pendingParent, kid14)).toBe(false)
  })

  it('a random user has no attendance management rights over a player', async () => {
    expect(await canManageAttendanceFor(outsider, kid14)).toBe(false)
  })
})

describe('F5 DOB requirement at player registration', () => {
  it('a player with a date of birth can be registered', async () => {
    const reg = await assignPlayer(admin, teamA, 'teen16@example.com')
    expect(reg.teamId).toBe(teamA)
  })

  it('registering a player WITHOUT a date of birth is a 400', async () => {
    await expect(assignPlayer(admin, teamA, 'outsider@example.com'))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
