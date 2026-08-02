import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin } from '../utils/roles'
import { clubs, clubAdmins } from '../db/schema'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** v1: single club. The first authenticated user to create it becomes its admin (bootstrap). */
export async function createClub(userId: string, input: { slug: string, name: string }) {
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid club slug (lowercase letters, digits, hyphens)' })
  }
  if (name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Club name too short' })
  }
  const db = getDb()
  const existing = await db.select({ id: clubs.id }).from(clubs).limit(1)
  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'A club already exists (single-club mode)' })
  }
  const [club] = await db.insert(clubs).values({ slug, name }).returning()
  await db.insert(clubAdmins).values({ clubId: club!.id, userId })
  return club!
}

/** The single club of this deployment, or null before bootstrap. Logo bytes stay out. */
export async function getCurrentClub() {
  const db = getDb()
  const rows = await db.select().from(clubs).limit(1)
  const row = rows[0]
  if (!row) return null
  const { logoData, logoMime, ...safe } = row
  return { ...safe, hasLogo: !!(logoData && logoMime) }
}

const HEX_RE = /^#[0-9a-f]{6}$/i
const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const LOGO_MAX_BYTES = 1_000_000

/** F20: store the club logo (admin only). data is the raw upload; capped and mime-checked. */
export async function setClubLogo(userId: string, clubId: string, upload: { data: Buffer, mime: string }) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (!LOGO_MIMES.includes(upload.mime)) {
    throw createError({ statusCode: 400, statusMessage: 'Logo must be PNG, JPEG, SVG or WebP' })
  }
  if (upload.data.length > LOGO_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'Logo is too large (max 1 MB)' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({ logoData: upload.data.toString('base64'), logoMime: upload.mime })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { stored: true, bytes: upload.data.length }
}

/** F20: the logo binary for serving, or null. */
export async function getClubLogo(clubId: string) {
  const db = getDb()
  const [club] = await db.select({ logoData: clubs.logoData, logoMime: clubs.logoMime })
    .from(clubs).where(eq(clubs.id, clubId))
  if (!club?.logoData || !club.logoMime) return null
  return { data: Buffer.from(club.logoData, 'base64'), mime: club.logoMime }
}

/** F20: set the theme primary color (admin only; hex like #1a7f37). */
export async function setClubBranding(userId: string, clubId: string, patch: { primaryColor?: string | null }) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (patch.primaryColor != null && !HEX_RE.test(patch.primaryColor)) {
    throw createError({ statusCode: 400, statusMessage: 'primaryColor must be a #rrggbb hex color' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({ primaryColor: patch.primaryColor ?? null })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { primaryColor: club.primaryColor }
}

const PASSWORD_POLICIES = ['low', 'medium', 'strong'] as const
export type ClubPasswordPolicy = typeof PASSWORD_POLICIES[number]

/**
 * F24: set the enforced password standard (admin only). Lowering below 'medium' is an
 * explicit decision - the UI confirms it with the admin before calling this.
 */
export async function setPasswordPolicy(userId: string, clubId: string, policy: ClubPasswordPolicy) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (!PASSWORD_POLICIES.includes(policy)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown password policy' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({ passwordPolicy: policy })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { passwordPolicy: club.passwordPolicy }
}

export async function updateClub(userId: string, clubId: string, patch: { name?: string }) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const name = patch.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Club name too short' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({ ...(name !== undefined ? { name } : {}) })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return club
}
