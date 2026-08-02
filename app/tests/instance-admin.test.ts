// Test-set for F26: instance admin separate from club admin - instance settings,
// instance admin management, and the separation itself.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import {
  getInstanceSettings, updateInstanceSettings, listInstanceAdmins,
  grantInstanceAdmin, revokeInstanceAdmin
} from '../server/services/instance'
import { createClub } from '../server/services/clubs'
import { getUserRoles } from '../server/utils/roles'
import { user } from '../server/db/schema'

let sysAdmin: string
let clubOnlyAdmin: string
let member: string

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user).values({ name: email.split('@')[0]!, email }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  sysAdmin = await makeUser('sys@example.com')
  clubOnlyAdmin = await makeUser('clubadmin@example.com')
  member = await makeUser('member@example.com')
  await makeInstanceAdmin(sysAdmin)
})

describe('F26 instance settings', () => {
  it('lazily creates defaults on first read', async () => {
    const settings = await getInstanceSettings()
    expect(settings.dateFormat).toBe('DD-MM-YYYY')
    expect(settings.timeFormat).toBe('24h')
    expect(settings.weekNumbering).toBe('iso')
  })

  it('instance admin updates settings', async () => {
    const updated = await updateInstanceSettings(sysAdmin, { dateFormat: 'YYYY-MM-DD', timeFormat: '12h' })
    expect(updated.dateFormat).toBe('YYYY-MM-DD')
    expect(updated.timeFormat).toBe('12h')
    expect(updated.weekNumbering).toBe('iso') // untouched
    expect((await getInstanceSettings()).dateFormat).toBe('YYYY-MM-DD')
  })

  it('non-instance-admins cannot update settings (edge)', async () => {
    await expect(updateInstanceSettings(member, { dateFormat: 'DD-MM-YYYY' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F26 separation: instance admin vs club admin', () => {
  it('a club admin is NOT an instance admin and vice versa', async () => {
    // sysAdmin creates the club and hands it to clubOnlyAdmin via club_admins.
    const club = await createClub(sysAdmin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
    const { clubAdmins } = await import('../server/db/schema')
    await getDb().insert(clubAdmins).values({ clubId: club.id, userId: clubOnlyAdmin })
    const clubRoles = await getUserRoles(clubOnlyAdmin)
    expect(clubRoles.instanceAdmin).toBe(false)
    expect(clubRoles.adminOfClubIds).toContain(club.id)
  })

  it('a club admin cannot touch instance concerns (edge)', async () => {
    await expect(updateInstanceSettings(clubOnlyAdmin, { timeFormat: '24h' }))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(listInstanceAdmins(clubOnlyAdmin))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('F26 instance admin management', () => {
  it('grants instance admin to a registered identity by email', async () => {
    await grantInstanceAdmin(sysAdmin, 'Member@Example.com') // case-insensitive
    const admins = await listInstanceAdmins(sysAdmin)
    expect(admins.map(a => a.email)).toContain('member@example.com')
    expect((await getUserRoles(member)).instanceAdmin).toBe(true)
  })

  it('rejects granting to an unknown email (edge)', async () => {
    await expect(grantInstanceAdmin(sysAdmin, 'ghost@example.com'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a duplicate grant (edge)', async () => {
    await expect(grantInstanceAdmin(sysAdmin, 'member@example.com'))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('non-instance-admins cannot grant (edge)', async () => {
    await expect(grantInstanceAdmin(clubOnlyAdmin, 'clubadmin@example.com'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('revokes an instance admin', async () => {
    const admins = await listInstanceAdmins(sysAdmin)
    const memberRow = admins.find(a => a.email === 'member@example.com')!
    await revokeInstanceAdmin(sysAdmin, memberRow.id)
    expect((await getUserRoles(member)).instanceAdmin).toBe(false)
  })

  it('never removes the last instance admin (edge)', async () => {
    const admins = await listInstanceAdmins(sysAdmin)
    expect(admins).toHaveLength(1)
    await expect(revokeInstanceAdmin(sysAdmin, admins[0]!.id))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
