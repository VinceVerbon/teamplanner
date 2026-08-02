// Test-set for F24 enforcement: the medium standard on every password-setting path
// (signup, reset, change) and the admin-configurable club policy.
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { sentMails } from '../server/utils/mailer'

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

describe('F24 default policy (medium) - enforcement per path', () => {
  it('applies before any club exists: default is medium', async () => {
    const { getPasswordPolicy } = await import('../server/utils/password-policy')
    expect(await getPasswordPolicy()).toBe('medium')
  })

  it('rejects a weak password at signup', async () => {
    await expect(auth.api.signUpEmail({
      body: { email: 'weak@example.com', password: 'abcdefgh', name: 'Weak' }
    })).rejects.toThrow()
  })

  it('rejects a common password at signup (edge)', async () => {
    await expect(auth.api.signUpEmail({
      body: { email: 'common@example.com', password: 'Password123', name: 'Common' }
    })).rejects.toThrow()
  })

  it('accepts a medium-or-better password at signup', async () => {
    const res = await auth.api.signUpEmail({
      body: { email: 'anna@example.com', password: 'Prima-Wachtwoord-1', name: 'Anna' }
    })
    expect(res.user.email).toBe('anna@example.com')
  })

  it('rejects a weak password on the reset path (edge)', async () => {
    const mail = lastMailTo('anna@example.com')!
    const verifyToken = new URL(tokenUrl(mail.text)).searchParams.get('token')!
    await auth.api.verifyEmail({ query: { token: verifyToken } })
    await auth.api.requestPasswordReset({ body: { email: 'anna@example.com', redirectTo: '/reset' } })
    const resetMail = lastMailTo('anna@example.com')!
    const url = new URL(tokenUrl(resetMail.text))
    const token = url.searchParams.get('token') ?? url.pathname.split('/').pop()
    await expect(auth.api.resetPassword({ body: { newPassword: 'abcdefgh', token: token! } }))
      .rejects.toThrow()
    // The same token with a compliant password works.
    await auth.api.resetPassword({ body: { newPassword: 'Hersteld-Wachtwoord-1', token: token! } })
    const signIn = await auth.api.signInEmail({
      body: { email: 'anna@example.com', password: 'Hersteld-Wachtwoord-1' }
    })
    expect(signIn.token).toBeTruthy()
  })
})

describe('F24 club-configurable policy', () => {
  let adminId: string
  let clubId: string

  beforeAll(async () => {
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const { createClub } = await import('../server/services/clubs')
    const [admin] = await getDb().insert(user)
      .values({ name: 'Admin', email: 'admin@example.com' }).returning()
    adminId = admin!.id
    await makeInstanceAdmin(adminId)
    const club = await createClub(adminId, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
    clubId = club.id
  })

  it('non-admins cannot change the policy (edge)', async () => {
    const { getDb } = await import('../server/utils/db')
    const { user } = await import('../server/db/schema')
    const { setPasswordPolicy } = await import('../server/services/clubs')
    const [pleb] = await getDb().insert(user)
      .values({ name: 'Lid', email: 'lid@example.com' }).returning()
    await expect(setPasswordPolicy(pleb!.id, clubId, 'low'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin lowers to low; a weak (but 8+) password is then accepted', async () => {
    const { setPasswordPolicy } = await import('../server/services/clubs')
    const result = await setPasswordPolicy(adminId, clubId, 'low')
    expect(result.passwordPolicy).toBe('low')
    const res = await auth.api.signUpEmail({
      body: { email: 'zwakmag@example.com', password: 'abcdefgh', name: 'Zwak Mag' }
    })
    expect(res.user.email).toBe('zwakmag@example.com')
  })

  it('even low never accepts blocked passwords (edge)', async () => {
    await expect(auth.api.signUpEmail({
      body: { email: 'geblokt@example.com', password: 'wachtwoord1', name: 'Geblokt' }
    })).rejects.toThrow()
  })

  it('admin raises to strong; a medium password is then rejected', async () => {
    const { setPasswordPolicy } = await import('../server/services/clubs')
    await setPasswordPolicy(adminId, clubId, 'strong')
    await expect(auth.api.signUpEmail({
      body: { email: 'middel@example.com', password: 'Abcdef12', name: 'Middel' }
    })).rejects.toThrow()
    const res = await auth.api.signUpEmail({
      body: { email: 'sterk@example.com', password: 'Heel-Sterk-Wachtwoord-2026!', name: 'Sterk' }
    })
    expect(res.user.email).toBe('sterk@example.com')
  })
})
