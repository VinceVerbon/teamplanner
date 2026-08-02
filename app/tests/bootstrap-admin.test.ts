// Test-set for F22: default admin seeded on a fresh install with an empty password,
// first-run forced password set, and the one-time nature of that path.
import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb } from './setup'

// Modules that (transitively) bind better-auth's adapter at import time are imported
// AFTER freshDb(), same pattern as auth.test.ts.
let accounts: typeof import('../server/services/accounts')
let auth: typeof import('../server/utils/auth').auth

beforeAll(async () => {
  await freshDb()
  accounts = await import('../server/services/accounts')
  auth = (await import('../server/utils/auth')).auth
})

describe('F22 seeding - main flow', () => {
  it('seeds the default admin on an empty database', async () => {
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(true)
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const [admin] = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    expect(admin).toBeDefined()
    expect(admin!.emailVerified).toBe(true)
    expect(admin!.isBootstrapAdmin).toBe(true)
    expect(admin!.mustSetPassword).toBe(true)
  })

  it('is idempotent: a second call never seeds again (edge)', async () => {
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(false)
  })

  it('reports the pending first-run state', async () => {
    const status = await accounts.bootstrapStatus()
    expect(status.pending).toBe(true)
    expect(status.email).toBe(accounts.BOOTSTRAP_ADMIN_EMAIL)
  })

  it('empty-password sign-in works ONLY in the bootstrap state and is fully gated (edge)', async () => {
    // This is the documented first-run semantics: the seeded admin's password is empty,
    // and any session it yields may reach nothing but the password endpoints.
    const signIn = await auth.api.signInEmail({
      body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: '' }
    })
    expect(signIn.token).toBeTruthy()
    const { requireUser } = await import('../server/utils/guards')
    const fakeEvent = (path: string) => ({
      headers: new Headers({ Authorization: `Bearer ${signIn.token}` }),
      path
    }) as unknown as import('h3').H3Event
    await expect(requireUser(fakeEvent('/api/teams')))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(requireUser(fakeEvent('/api/me/password')))
      .resolves.toMatchObject({ email: accounts.BOOTSTRAP_ADMIN_EMAIL })
  })
})

describe('F22 first-run password set', () => {
  it('rejects a password below the default medium policy', async () => {
    await expect(accounts.setBootstrapPassword('abcdefgh'))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('sets a policy-compliant password, clears the flag, and sign-in works', async () => {
    // A session grabbed via the empty bootstrap password must die when the password is set.
    const bootstrapSignIn = await auth.api.signInEmail({
      body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: '' }
    })
    const result = await accounts.setBootstrapPassword('Stevig-Wachtwoord-2026')
    expect(result.email).toBe(accounts.BOOTSTRAP_ADMIN_EMAIL)
    const status = await accounts.bootstrapStatus()
    expect(status.pending).toBe(false)
    const stale = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${bootstrapSignIn.token}` })
    })
    expect(stale).toBeNull()
    const signIn = await auth.api.signInEmail({
      body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: 'Stevig-Wachtwoord-2026' }
    })
    expect(signIn.token).toBeTruthy()
    // And the empty password itself is dead.
    await expect(
      auth.api.signInEmail({ body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: '' } })
    ).rejects.toThrow()
  })

  it('the empty-password path is dead forever afterwards (edge)', async () => {
    await expect(accounts.setBootstrapPassword('Ander-Stevig-Wachtwoord-1'))
      .rejects.toMatchObject({ statusCode: 410 })
  })
})

describe('F22/F26 admin rights', () => {
  it('the bootstrap admin is the first INSTANCE admin, not implicitly a club admin', async () => {
    const { getDb } = await import('../server/utils/db')
    const { user, clubs } = await import('../server/db/schema')
    const { getUserRoles, isClubAdmin, isInstanceAdmin } = await import('../server/utils/roles')
    // Club inserted by someone else entirely (no club_admins row for anyone).
    const [club] = await getDb().insert(clubs).values({ slug: 'fcaalsmeer', name: 'FC Aalsmeer' }).returning()
    const [admin] = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    const roles = await getUserRoles(admin!.id)
    expect(isInstanceAdmin(roles)).toBe(true)
    // F26: club management is entirely separate from instance management.
    expect(isClubAdmin(roles, club!.id)).toBe(false)
  })
})

describe('F22 seeding - existing installs are never touched', () => {
  it('does not seed when any user already exists (edge)', async () => {
    // Fresh database again; NOTE: no auth API usage after this point (its adapter is
    // bound to the previous instance).
    await freshDb()
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    await getDb().insert(user).values({ name: 'Existing', email: 'existing@example.com' })
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(false)
    const rows = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    expect(rows).toHaveLength(0)
  })
})

describe('F26 instance-admin backfill for pre-split databases', () => {
  it('promotes a bootstrap admin that has no instance_admins row, exactly once (edge)', async () => {
    await freshDb()
    const { getDb } = await import('../server/utils/db')
    const { user, instanceAdmins } = await import('../server/db/schema')
    // Simulate a database seeded before the split: bootstrap flag, no instance admin.
    const [admin] = await getDb().insert(user).values({
      name: 'Beheerder', email: accounts.BOOTSTRAP_ADMIN_EMAIL,
      emailVerified: true, isBootstrapAdmin: true
    }).returning()
    const first = await accounts.ensureInstanceAdminBackfill()
    expect(first.backfilled).toBe(true)
    const rows = await getDb().select().from(instanceAdmins)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userId).toBe(admin!.id)
    // Idempotent: never a second row.
    expect((await accounts.ensureInstanceAdminBackfill()).backfilled).toBe(false)
    expect(await getDb().select().from(instanceAdmins)).toHaveLength(1)
  })

  it('does nothing on a database without a bootstrap admin (edge)', async () => {
    await freshDb()
    const { getDb } = await import('../server/utils/db')
    const { user, instanceAdmins } = await import('../server/db/schema')
    await getDb().insert(user).values({ name: 'Regular', email: 'regular@example.com' })
    expect((await accounts.ensureInstanceAdminBackfill()).backfilled).toBe(false)
    expect(await getDb().select().from(instanceAdmins)).toHaveLength(0)
  })
})
