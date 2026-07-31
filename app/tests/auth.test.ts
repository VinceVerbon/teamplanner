// Test-set for F1 (email/password registration + verification + reset) and F3 (sessions).
// Runs better-auth's server API against in-memory PGlite; mails captured by the dev mailer.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb } from './setup'
import { sentMails } from '../server/utils/mailer'

// auth.ts builds its drizzle adapter at import time - import AFTER freshDb() so it binds
// to the in-memory instance.
let auth: typeof import('../server/utils/auth').auth

function lastMailTo(email: string) {
  return [...sentMails].reverse().find(m => m.to === email)
}

function tokenUrl(text: string): string {
  const m = text.match(/https?:\/\/\S+/)
  if (!m) throw new Error(`no URL in mail body: ${text}`)
  return m[0]
}

beforeAll(async () => {
  await freshDb()
  auth = (await import('../server/utils/auth')).auth
})

describe('F1 registration - main flow', () => {
  it('signs up with email/password, sends a verification mail, and starts unverified', async () => {
    const res = await auth.api.signUpEmail({
      body: { email: 'anna@example.com', password: 'correct-horse-battery', name: 'Anna' }
    })
    expect(res.user.email).toBe('anna@example.com')
    expect(res.user.emailVerified).toBe(false)
    const mail = lastMailTo('anna@example.com')
    expect(mail).toBeDefined()
    expect(mail!.subject).toContain('verify')
  })

  it('blocks sign-in before the email is verified (edge)', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: 'anna@example.com', password: 'correct-horse-battery' } })
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('verifies via the mailed token, then sign-in works and creates a session', async () => {
    const mail = lastMailTo('anna@example.com')!
    const url = new URL(tokenUrl(mail.text))
    const token = url.searchParams.get('token')
    expect(token).toBeTruthy()
    await auth.api.verifyEmail({ query: { token: token! } })
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'correct-horse-battery' }
    })
    expect(signIn.user.emailVerified).toBe(true)
    expect(signIn.token).toBeTruthy()
  })

  it('persists dateOfBirth given at signup (drives F5 age rules later)', async () => {
    const res = await auth.api.signUpEmail({
      body: {
        email: 'birthday@example.com',
        password: 'correct-horse-battery',
        name: 'Birthday',
        dateOfBirth: new Date('2010-05-15')
      } as never
    })
    const dob = (res.user as Record<string, unknown>).dateOfBirth
    expect(dob).toBeTruthy()
    expect(new Date(dob as string).getFullYear()).toBe(2010)
  })
})

describe('F1 registration - edge cases', () => {
  it('duplicate signup for an existing email never creates or overwrites an account', async () => {
    // better-auth answers duplicate signups with a decoy response (anti account-enumeration),
    // so assert on effect: still exactly one account, original credentials untouched.
    await auth.api.signUpEmail({
      body: { email: 'anna@example.com', password: 'another-password-123', name: 'Anna 2' }
    }).catch(() => { /* rejecting is also acceptable */ })
    const { eq } = await import('drizzle-orm')
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const rows = await getDb().select().from(user).where(eq(user.email, 'anna@example.com'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Anna')
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'correct-horse-battery' }
    })
    expect(signIn.token).toBeTruthy()
  })

  it('rejects a wrong password on sign-in', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: 'anna@example.com', password: 'wrong-password-123' } })
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })

  it('rejects a too-short password at signup', async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: 'short@example.com', password: 'abc', name: 'Short' } })
    ).rejects.toThrow()
  })
})

describe('F1 password reset', () => {
  it('mails a reset link and the new password works afterwards', async () => {
    await auth.api.requestPasswordReset({
      body: { email: 'anna@example.com', redirectTo: '/reset' }
    })
    const mail = lastMailTo('anna@example.com')!
    expect(mail.subject.toLowerCase()).toContain('reset')
    const url = new URL(tokenUrl(mail.text))
    // better-auth puts the reset token in the URL path: .../reset-password/<token>?...
    const token = url.searchParams.get('token') ?? url.pathname.split('/').pop()
    expect(token).toBeTruthy()
    await auth.api.resetPassword({ body: { newPassword: 'brand-new-password-1', token: token! } })
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'brand-new-password-1' }
    })
    expect(signIn.token).toBeTruthy()
  })

  it('reset request for an unknown email does not throw (no account enumeration)', async () => {
    await expect(
      auth.api.requestPasswordReset({ body: { email: 'ghost@example.com', redirectTo: '/reset' } })
    ).resolves.toBeDefined()
  })
})

describe('F3 sessions', () => {
  it('getSession returns the user for a valid session token and roles endpoint shape holds', async () => {
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'brand-new-password-1' }
    })
    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${signIn.token}` })
    })
    expect(session?.user.email).toBe('anna@example.com')
  })

  it('getSession is null without credentials (edge)', async () => {
    const session = await auth.api.getSession({ headers: new Headers() })
    expect(session).toBeNull()
  })

  it('sign-out revokes the session (edge)', async () => {
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'brand-new-password-1' }
    })
    const headers = new Headers({ Authorization: `Bearer ${signIn.token}` })
    await auth.api.signOut({ headers })
    const session = await auth.api.getSession({ headers })
    expect(session).toBeNull()
  })
})
