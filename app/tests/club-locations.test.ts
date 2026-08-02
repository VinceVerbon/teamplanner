// Test-set for F27: club locations (checkmark) and the single main location (the
// club's own address/main site).
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub, getCurrentClub, setMainLocation } from '../server/services/clubs'
import { createLocation, updateLocation, deleteLocation, listLocations } from '../server/services/schedule'
import { user } from '../server/db/schema'

let admin: string
let member: string
let clubId: string
let groundsId: string
let hallId: string
let awayId: string

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
  groundsId = (await createLocation(admin, { name: 'Sportpark Hornmeer', address: 'Beethovenlaan 132' })).id
  hallId = (await createLocation(admin, { name: 'Sporthal De Bloemhof', address: 'Hornweg 187' })).id
  awayId = (await createLocation(admin, { name: 'Uitlocatie Elders' })).id
})

async function getLocation(id: string) {
  const all = await listLocations()
  return all.find(l => l.id === id)!
}

describe('F27 club locations - main flow', () => {
  it('locations start as non-club locations', async () => {
    expect((await getLocation(hallId)).isClubLocation).toBe(false)
  })

  it('admin marks a location as club location (checkmark)', async () => {
    const loc = await updateLocation(admin, hallId, { isClubLocation: true })
    expect(loc.isClubLocation).toBe(true)
  })

  it('setting the main location marks it as club location automatically', async () => {
    const result = await setMainLocation(admin, clubId, groundsId)
    expect(result.mainLocationId).toBe(groundsId)
    expect((await getLocation(groundsId)).isClubLocation).toBe(true)
    expect((await getCurrentClub())?.mainLocationId).toBe(groundsId)
  })

  it('only one main location: setting a new one replaces the old', async () => {
    const result = await setMainLocation(admin, clubId, hallId)
    expect(result.mainLocationId).toBe(hallId)
    expect((await getCurrentClub())?.mainLocationId).toBe(hallId)
    // put it back for the remaining tests
    await setMainLocation(admin, clubId, groundsId)
  })

  it('the main location can be cleared explicitly', async () => {
    await setMainLocation(admin, clubId, null)
    expect((await getCurrentClub())?.mainLocationId).toBeNull()
    await setMainLocation(admin, clubId, groundsId)
  })
})

describe('F27 club locations - edge cases', () => {
  it('the main location cannot lose its club-location mark (edge)', async () => {
    await expect(updateLocation(admin, groundsId, { isClubLocation: false }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('a non-main club location CAN be unmarked (edge)', async () => {
    const loc = await updateLocation(admin, hallId, { isClubLocation: false })
    expect(loc.isClubLocation).toBe(false)
  })

  it('a location outside the club cannot become main (edge)', async () => {
    await expect(setMainLocation(admin, clubId, 'no-such-location'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-admins cannot set the main location or flags (edge)', async () => {
    await expect(setMainLocation(member, clubId, awayId))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(updateLocation(member, awayId, { isClubLocation: true }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('deleting the main location clears the club main pointer (edge)', async () => {
    await deleteLocation(admin, groundsId)
    expect((await getCurrentClub())?.mainLocationId).toBeNull()
  })
})
