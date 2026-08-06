// Test-set for F22 + F31: default admin seeded with an UNUSABLE (null) password,
// token-gated one-shot first-run password set, seeding idempotent on the
// isBootstrapAdmin flag, and the rate-limit/token primitives behind the routes.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { eq, and } from 'drizzle-orm'
import type { H3Event } from 'h3'
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

describe('F22/F31 seeding - main flow', () => {
  it('seeds the default admin on an empty database with a NULL password', async () => {
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(true)
    const { getDb } = await import('../server/utils/db')
    const { user, account } = await import('../server/db/schema')
    const [admin] = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    expect(admin).toBeDefined()
    expect(admin!.emailVerified).toBe(true)
    expect(admin!.isBootstrapAdmin).toBe(true)
    expect(admin!.mustSetPassword).toBe(true)
    const [cred] = await getDb().select().from(account)
      .where(and(eq(account.userId, admin!.id), eq(account.providerId, 'credential')))
    expect(cred).toBeDefined()
    expect(cred!.password).toBeNull()
  })

  it('is idempotent: a second call never seeds again (edge)', async () => {
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(false)
  })

  it('reports the pending first-run state as a boolean only (no email oracle)', async () => {
    const status = await accounts.bootstrapStatus()
    expect(status.pending).toBe(true)
    expect('email' in status).toBe(false)
  })

  it('the seeded credential can NEVER sign in - empty password is rejected (edge)', async () => {
    // F31: pre-F31 seeds stored scrypt('') so `password: ''` authenticated during
    // the bootstrap window. The null-password seed closes that path entirely.
    await expect(
      auth.api.signInEmail({ body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: '' } })
    ).rejects.toThrow()
  })
})

describe('F22/F31 first-run password set', () => {
  it('rejects a password below the default medium policy', async () => {
    await expect(accounts.setBootstrapPassword('abcdefgh'))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('sets a policy-compliant password, clears the flag, and sign-in works', async () => {
    const result = await accounts.setBootstrapPassword('Stevig-Wachtwoord-2026')
    expect(result.email).toBe(accounts.BOOTSTRAP_ADMIN_EMAIL)
    const status = await accounts.bootstrapStatus()
    expect(status.pending).toBe(false)
    const signIn = await auth.api.signInEmail({
      body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: 'Stevig-Wachtwoord-2026' }
    })
    expect(signIn.token).toBeTruthy()
    // And the empty password stays dead.
    await expect(
      auth.api.signInEmail({ body: { email: accounts.BOOTSTRAP_ADMIN_EMAIL, password: '' } })
    ).rejects.toThrow()
  })

  it('the first-run path is dead forever afterwards (edge)', async () => {
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

describe('F31 seeding idempotency - keyed on isBootstrapAdmin, not "zero users"', () => {
  it('seeds even when other users exist, as long as no bootstrap admin does (edge)', async () => {
    // The pre-F31 "zero users" check let a stranger's signup suppress seeding forever.
    // NOTE: no auth API usage after freshDb() (its adapter is bound to the previous
    // instance) - DB-level assertions only from here on.
    await freshDb()
    const { getDb } = await import('../server/utils/db')
    const { user, account, instanceAdmins } = await import('../server/db/schema')
    await getDb().insert(user).values({ name: 'Stranger', email: 'stranger@example.com' })
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(true)
    const [admin] = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    expect(admin!.isBootstrapAdmin).toBe(true)
    const [cred] = await getDb().select().from(account)
      .where(eq(account.userId, admin!.id))
    expect(cred!.password).toBeNull()
    // Recovery path: the seeded admin is (also) an instance admin.
    const admins = await getDb().select().from(instanceAdmins)
    expect(admins.some(a => a.userId === admin!.id)).toBe(true)
  })

  it('never seeds twice, even after first-run setup completed (edge)', async () => {
    // Simulate a completed install: bootstrap admin exists, password set, flag cleared.
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    await getDb().update(user).set({ mustSetPassword: false })
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    const result = await accounts.ensureBootstrapAdmin()
    expect(result.seeded).toBe(false)
    const rows = await getDb().select().from(user)
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    expect(rows).toHaveLength(1)
  })
})

describe('F31 legacy pre-F31 seeds still complete their first run', () => {
  it('accepts the old scrypt("") credential and replaces it (edge)', async () => {
    await freshDb()
    const { getDb } = await import('../server/utils/db')
    const { user, account } = await import('../server/db/schema')
    const { hashPassword } = await import('better-auth/crypto')
    // A database seeded before F31: empty-string hash instead of null.
    const [admin] = await getDb().insert(user).values({
      name: 'Beheerder', email: accounts.BOOTSTRAP_ADMIN_EMAIL,
      emailVerified: true, isBootstrapAdmin: true, mustSetPassword: true
    }).returning()
    await getDb().insert(account).values({
      accountId: admin!.id, providerId: 'credential', userId: admin!.id,
      password: await hashPassword('')
    })
    const result = await accounts.setBootstrapPassword('Stevig-Wachtwoord-2026')
    expect(result.email).toBe(accounts.BOOTSTRAP_ADMIN_EMAIL)
    expect((await accounts.bootstrapStatus()).pending).toBe(false)
  })

  it('refuses when the credential already holds a real password (edge)', async () => {
    // mustSetPassword still true (e.g. crashed mid-flow after the password update):
    // the seed-credential check must refuse to overwrite a real password.
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    await getDb().update(user).set({ mustSetPassword: true })
      .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
    await expect(accounts.setBootstrapPassword('Nog-Een-Wachtwoord-3'))
      .rejects.toMatchObject({ statusCode: 410 })
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

describe('F31 bootstrap token gate', () => {
  const ORIGINAL = process.env.BOOTSTRAP_TOKEN

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BOOTSTRAP_TOKEN
    else process.env.BOOTSTRAP_TOKEN = ORIGINAL
  })

  function fakeEvent(headers: Record<string, string>, url = '/api/bootstrap/status') {
    return {
      path: url,
      node: { req: { headers, url } }
    } as unknown as H3Event
  }

  it('refuses entirely (404) when BOOTSTRAP_TOKEN is not configured', async () => {
    delete process.env.BOOTSTRAP_TOKEN
    const { requireBootstrapToken } = await import('../server/utils/bootstrap-token')
    expect(() => requireBootstrapToken(fakeEvent({ 'x-bootstrap-token': 'anything' })))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
  })

  it('rejects a wrong or missing token (401) (edge)', async () => {
    process.env.BOOTSTRAP_TOKEN = 'correct-token-value'
    const { requireBootstrapToken } = await import('../server/utils/bootstrap-token')
    expect(() => requireBootstrapToken(fakeEvent({ 'x-bootstrap-token': 'wrong' })))
      .toThrowError(expect.objectContaining({ statusCode: 401 }))
    expect(() => requireBootstrapToken(fakeEvent({})))
      .toThrowError(expect.objectContaining({ statusCode: 401 }))
  })

  it('accepts the configured token via header and via query', async () => {
    process.env.BOOTSTRAP_TOKEN = 'correct-token-value'
    const { requireBootstrapToken } = await import('../server/utils/bootstrap-token')
    expect(() => requireBootstrapToken(fakeEvent({ 'x-bootstrap-token': 'correct-token-value' })))
      .not.toThrow()
    expect(() => requireBootstrapToken(
      fakeEvent({}, '/api/bootstrap/status?token=correct-token-value')
    )).not.toThrow()
  })
})

describe('F31 rate limiter', () => {
  it('allows max attempts in a window, then answers 429 (edge)', async () => {
    const { assertRateLimit, resetRateLimits } = await import('../server/utils/rate-limit')
    resetRateLimits()
    for (let i = 0; i < 5; i++) {
      expect(() => assertRateLimit('test-key', 5, 60_000)).not.toThrow()
    }
    expect(() => assertRateLimit('test-key', 5, 60_000))
      .toThrowError(expect.objectContaining({ statusCode: 429 }))
    // Other keys are unaffected.
    expect(() => assertRateLimit('other-key', 5, 60_000)).not.toThrow()
  })

  it('resets after the window expires (edge)', async () => {
    const { assertRateLimit, resetRateLimits } = await import('../server/utils/rate-limit')
    resetRateLimits()
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 5; i++) assertRateLimit('window-key', 5, 60_000)
      expect(() => assertRateLimit('window-key', 5, 60_000))
        .toThrowError(expect.objectContaining({ statusCode: 429 }))
      vi.advanceTimersByTime(60_001)
      expect(() => assertRateLimit('window-key', 5, 60_000)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
