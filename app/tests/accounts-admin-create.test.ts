// Test-set for F23: admin creates accounts directly (unverified emails allowed, no
// verification mail) plus the mustSetPassword gate and the own-password change flow.
import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { freshDb } from './setup'
import { sentMails } from '../server/utils/mailer'

let accounts: typeof import('../server/services/accounts')
let auth: typeof import('../server/utils/auth').auth
let adminId: string

function fakeEvent(token: string, path: string): H3Event {
  return {
    headers: new Headers({ Authorization: `Bearer ${token}` }),
    path
  } as unknown as H3Event
}

beforeAll(async () => {
  await freshDb()
  accounts = await import('../server/services/accounts')
  auth = (await import('../server/utils/auth')).auth
  await accounts.ensureBootstrapAdmin()
  await accounts.setBootstrapPassword('Stevig-Wachtwoord-2026')
  const { getDb } = await import('../server/utils/db')
  const { user } = await import('../server/db/schema')
  const [admin] = await getDb().select().from(user)
    .where(eq(user.email, accounts.BOOTSTRAP_ADMIN_EMAIL))
  adminId = admin!.id
})

describe('F23 admin account creation', () => {
  it('an instance admin can create accounts even before any club exists (F26)', async () => {
    const created = await accounts.createMemberAccount(adminId, {
      name: 'Vroege Vogel', email: 'vroeg@example.com', password: 'Prima-Wachtwoord-1',
      mustChangePassword: false
    })
    expect(created.email).toBe('vroeg@example.com')
  })

  it('admin creates an account with an unverified email; sign-in works immediately', async () => {
    const { createClub } = await import('../server/services/clubs')
    await createClub(adminId, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })

    const mailsBefore = sentMails.length
    const created = await accounts.createMemberAccount(adminId, {
      name: 'Jan Janssen',
      email: 'Jan@Example.com', // normalized to lowercase
      password: 'Tijdelijk-Wachtwoord-1',
      dateOfBirth: '2010-05-15',
      mustChangePassword: true
    })
    expect(created.email).toBe('jan@example.com')
    expect(created.mustSetPassword).toBe(true)
    // No verification mail: the admin vouches for the address.
    expect(sentMails.length).toBe(mailsBefore)
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const [row] = await getDb().select().from(user).where(eq(user.id, created.id))
    expect(row!.emailVerified).toBe(true)
    expect(row!.dateOfBirth).toBe('2010-05-15')
    // Sign-in works without any verification step.
    const signIn = await auth.api.signInEmail({
      body: { email: 'jan@example.com', password: 'Tijdelijk-Wachtwoord-1' }
    })
    expect(signIn.token).toBeTruthy()
  })

  it('non-admins get a 403 (edge)', async () => {
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const [pleb] = await getDb().insert(user)
      .values({ name: 'Gewoon Lid', email: 'lid@example.com' }).returning()
    await expect(accounts.createMemberAccount(pleb!.id, {
      name: 'X Y', email: 'x@example.com', password: 'Tijdelijk-Wachtwoord-1'
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('duplicate email is a 409 (edge)', async () => {
    await expect(accounts.createMemberAccount(adminId, {
      name: 'Jan Kopie', email: 'jan@example.com', password: 'Tijdelijk-Wachtwoord-1'
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('the initial password must meet the policy too (edge)', async () => {
    await expect(accounts.createMemberAccount(adminId, {
      name: 'Zwak Wachtwoord', email: 'zwak@example.com', password: 'abcdefgh'
    })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('F22/F23 mustSetPassword gate + forced change', () => {
  let janToken: string

  beforeAll(async () => {
    const signIn = await auth.api.signInEmail({
      body: { email: 'jan@example.com', password: 'Tijdelijk-Wachtwoord-1' }
    })
    janToken = signIn.token!
  })

  it('blocks every API except the password-change endpoints while the flag is set', async () => {
    const { requireUser } = await import('../server/utils/guards')
    await expect(requireUser(fakeEvent(janToken, '/api/teams')))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(requireUser(fakeEvent(janToken, '/api/me/password')))
      .resolves.toMatchObject({ email: 'jan@example.com' })
    await expect(requireUser(fakeEvent(janToken, '/api/me')))
      .resolves.toMatchObject({ email: 'jan@example.com' })
  })

  it('rejects a change with a wrong current password (edge)', async () => {
    await expect(accounts.changeOwnPassword(
      new Headers({ Authorization: `Bearer ${janToken}` }), 'helemaal-fout', 'Nieuw-Eigen-Wachtwoord-1'
    )).rejects.toThrow()
  })

  it('rejects a new password below the policy (edge)', async () => {
    await expect(accounts.changeOwnPassword(
      new Headers({ Authorization: `Bearer ${janToken}` }), 'Tijdelijk-Wachtwoord-1', 'abcdefgh'
    )).rejects.toThrow()
  })

  it('changes the password, clears the flag, and the gate opens', async () => {
    const headers = new Headers({ Authorization: `Bearer ${janToken}` })
    await accounts.changeOwnPassword(headers, 'Tijdelijk-Wachtwoord-1', 'Nieuw-Eigen-Wachtwoord-1')
    // changePassword revoked other sessions; sign in fresh with the new password.
    const signIn = await auth.api.signInEmail({
      body: { email: 'jan@example.com', password: 'Nieuw-Eigen-Wachtwoord-1' }
    })
    expect(signIn.token).toBeTruthy()
    const { requireUser } = await import('../server/utils/guards')
    await expect(requireUser(fakeEvent(signIn.token!, '/api/teams')))
      .resolves.toMatchObject({ email: 'jan@example.com' })
  })

  it('accounts created without the forced change are not gated (edge)', async () => {
    const created = await accounts.createMemberAccount(adminId, {
      name: 'Piet Vrij',
      email: 'piet@example.com',
      password: 'Eigen-Gekozen-Wachtwoord-1',
      mustChangePassword: false
    })
    expect(created.mustSetPassword).toBe(false)
    const signIn = await auth.api.signInEmail({
      body: { email: 'piet@example.com', password: 'Eigen-Gekozen-Wachtwoord-1' }
    })
    const { requireUser } = await import('../server/utils/guards')
    await expect(requireUser(fakeEvent(signIn.token!, '/api/teams')))
      .resolves.toMatchObject({ email: 'piet@example.com' })
  })
})
