import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { getUserRoles, isClubAdmin, isInstanceAdmin } from '../utils/roles'
import { clubs, clubAdmins, locations } from '../db/schema'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/**
 * F26: creating a club is an instance-level action (one instance can hold multiple
 * clubs later; v1 still enforces a single club). The creator becomes the club's admin.
 */
export async function createClub(userId: string, input: { slug: string, name: string }) {
  const roles = await getUserRoles(userId)
  if (!isInstanceAdmin(roles)) {
    throw createError({ statusCode: 403, statusMessage: 'Instance admin role required' })
  }
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

const NAV_PLACEMENTS = ['left', 'top', 'right'] as const
export type NavPlacement = typeof NAV_PLACEMENTS[number]

/** F20/F25: theme settings - primary color (hex like #1a7f37) and nav placement. */
export async function setClubBranding(
  userId: string, clubId: string, patch: { primaryColor?: string | null, navPlacement?: NavPlacement }
) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (patch.primaryColor != null && !HEX_RE.test(patch.primaryColor)) {
    throw createError({ statusCode: 400, statusMessage: 'primaryColor must be a #rrggbb hex color' })
  }
  if (patch.navPlacement !== undefined && !NAV_PLACEMENTS.includes(patch.navPlacement)) {
    throw createError({ statusCode: 400, statusMessage: 'navPlacement must be left, top or right' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({
      ...('primaryColor' in patch ? { primaryColor: patch.primaryColor ?? null } : {}),
      ...(patch.navPlacement !== undefined ? { navPlacement: patch.navPlacement } : {})
    })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { primaryColor: club.primaryColor, navPlacement: club.navPlacement }
}

/**
 * F27: set (or clear) the club's main location - its own address/main site. Exactly one;
 * setting a new one replaces the old. A main location is by definition a club location.
 */
export async function setMainLocation(userId: string, clubId: string, locationId: string | null) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const db = getDb()
  if (locationId !== null) {
    const [loc] = await db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.clubId, clubId)))
    if (!loc) throw createError({ statusCode: 404, statusMessage: 'Location not found in this club' })
    await db.update(locations).set({ isClubLocation: true }).where(eq(locations.id, locationId))
  }
  const [club] = await db.update(clubs)
    .set({ mainLocationId: locationId })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { mainLocationId: club.mainLocationId }
}

const PASSWORD_POLICIES = ['low', 'medium', 'strong', 'custom'] as const
export type ClubPasswordPolicy = typeof PASSWORD_POLICIES[number]

export interface CustomPolicyRulesInput {
  minLength: number
  requireLowercase: boolean
  requireUppercase: boolean
  requireDigit: boolean
  requireSymbol: boolean
}

/**
 * F24: set the enforced password standard (admin only). Lowering below 'medium' is an
 * explicit decision - the UI confirms it with the admin before calling this. 'custom'
 * stores explicit rules (min length + required character elements).
 */
export async function setPasswordPolicy(
  userId: string, clubId: string, policy: ClubPasswordPolicy, custom?: CustomPolicyRulesInput
) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  if (!PASSWORD_POLICIES.includes(policy)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown password policy' })
  }
  if (policy === 'custom') {
    if (!custom) {
      throw createError({ statusCode: 400, statusMessage: 'Custom policy requires its rules' })
    }
    if (!Number.isInteger(custom.minLength) || custom.minLength < 8 || custom.minLength > 128) {
      throw createError({ statusCode: 400, statusMessage: 'Custom minimum length must be between 8 and 128' })
    }
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({
      passwordPolicy: policy,
      ...(policy === 'custom' && custom
        ? {
            passwordCustomMinLength: custom.minLength,
            passwordCustomRequireLowercase: custom.requireLowercase,
            passwordCustomRequireUppercase: custom.requireUppercase,
            passwordCustomRequireDigit: custom.requireDigit,
            passwordCustomRequireSymbol: custom.requireSymbol
          }
        : {})
    })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return { passwordPolicy: club.passwordPolicy }
}

const CLUB_REGIONS = ['noord', 'oost', 'west', 'zuid'] as const
export type ClubRegion = typeof CLUB_REGIONS[number]

export async function updateClub(userId: string, clubId: string, patch: {
  name?: string
  // F28: a club always plays in a region; the flag offers the nationale kalender at team level.
  region?: ClubRegion | null
  hasNationalTeams?: boolean
}) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
  const name = patch.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Club name too short' })
  }
  if (patch.region != null && !CLUB_REGIONS.includes(patch.region)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown region' })
  }
  const db = getDb()
  const [club] = await db.update(clubs)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...('region' in patch ? { region: patch.region ?? null } : {}),
      ...(patch.hasNationalTeams !== undefined ? { hasNationalTeams: patch.hasNationalTeams } : {})
    })
    .where(eq(clubs.id, clubId))
    .returning()
  if (!club) throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  return club
}
