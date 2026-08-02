// Test-set for F20 (club branding & theming).
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import {
  createClub, getCurrentClub, setClubLogo, getClubLogo, setClubBranding
} from '../server/services/clubs'
import { dominantColorFromPixels } from '../shared/utils/dominant-color'
import { user } from '../server/db/schema'

let admin: string
let member: string
let clubId: string

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user).values({ name: email.split('@')[0]!, email }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  member = await makeUser('member@example.com')
  await makeInstanceAdmin(admin)
  clubId = (await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })).id
})

describe('F20 dominant color (pure function)', () => {
  function px(...rgba: number[][]): number[] {
    return rgba.flat()
  }

  it('picks the most common saturated color, averaging within its bucket', () => {
    const red = [200, 30, 40, 255]
    const blue = [30, 40, 200, 255]
    const color = dominantColorFromPixels(px(red, red, red, blue))
    expect(color).toBe('#c81e28')
  })

  it('ignores transparent, near-white, near-black and grey pixels', () => {
    const noise = px(
      [255, 255, 255, 255], // white
      [250, 250, 250, 255], // near-white
      [5, 5, 5, 255], // near-black
      [128, 128, 128, 255], // grey
      [200, 30, 40, 0] // transparent red
    )
    expect(dominantColorFromPixels(noise)).toBeNull()
    const withBrand = [...noise, ...px([30, 120, 60, 255], [30, 120, 60, 255])]
    expect(dominantColorFromPixels(withBrand)).toBe('#1e783c')
  })
})

describe('F20 logo upload & serving', () => {
  it('admin uploads a logo; it round-trips with the right mime; hasLogo flips', async () => {
    const before = await getCurrentClub()
    expect(before!.hasLogo).toBe(false)
    const res = await setClubLogo(admin, clubId, { data: PNG_BYTES, mime: 'image/png' })
    expect(res.stored).toBe(true)
    const logo = await getClubLogo(clubId)
    expect(logo!.mime).toBe('image/png')
    expect(Buffer.compare(logo!.data, PNG_BYTES)).toBe(0)
    const after = await getCurrentClub()
    expect(after!.hasLogo).toBe(true)
    // the JSON payload never carries the logo bytes
    expect(Object.keys(after!)).not.toContain('logoData')
  })

  it('non-admin cannot upload; bad mime and oversize are 400s', async () => {
    await expect(setClubLogo(member, clubId, { data: PNG_BYTES, mime: 'image/png' }))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(setClubLogo(admin, clubId, { data: PNG_BYTES, mime: 'application/pdf' }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(setClubLogo(admin, clubId, { data: Buffer.alloc(1_000_001), mime: 'image/png' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('F20 theme color', () => {
  it('admin sets a valid hex color; it lands on the current club payload', async () => {
    const res = await setClubBranding(admin, clubId, { primaryColor: '#1A7F37' })
    expect(res.primaryColor).toBe('#1A7F37')
    const club = await getCurrentClub()
    expect(club!.primaryColor).toBe('#1A7F37')
  })

  it('invalid hex is a 400; non-admin is a 403; null clears the color', async () => {
    await expect(setClubBranding(admin, clubId, { primaryColor: 'groen' }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(setClubBranding(member, clubId, { primaryColor: '#112233' }))
      .rejects.toMatchObject({ statusCode: 403 })
    const cleared = await setClubBranding(admin, clubId, { primaryColor: null })
    expect(cleared.primaryColor).toBeNull()
  })
})
