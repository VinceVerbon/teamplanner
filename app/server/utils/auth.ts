import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import { createAuthMiddleware, APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb } from './db'
import { sendMail } from './mailer'
import { getPasswordPolicy } from './password-policy'
import { meetsPolicy, policyErrorMessage } from '../../shared/utils/password-strength'
import * as schema from '../db/schema'

// F24: every better-auth path that sets a password goes through the policy gate.
const PASSWORD_SETTING_PATHS = ['/sign-up/email', '/reset-password', '/change-password']

function socialProviders() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return {}
  return { google: { clientId, clientSecret } }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-never-use-in-production',
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification
    }
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'teamplanner - reset your password / wachtwoord opnieuw instellen',
        text: `Reset your password via this link:\n${url}\n\nIf you did not request this, ignore this mail.`
      })
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'teamplanner - verify your email / bevestig je e-mailadres',
        text: `Welcome to teamplanner! Verify your email via this link:\n${url}`
      })
    }
  },
  user: {
    additionalFields: {
      dateOfBirth: {
        type: 'date',
        required: false,
        input: true
      },
      // Server-managed flags (F22/F23): never settable from a signup/update body.
      mustSetPassword: {
        type: 'boolean',
        required: false,
        input: false
      },
      isBootstrapAdmin: {
        type: 'boolean',
        required: false,
        input: false
      }
    }
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!PASSWORD_SETTING_PATHS.some(p => ctx.path === p || ctx.path.startsWith(`${p}/`))) return
      const body = ctx.body as { password?: string, newPassword?: string } | undefined
      const password = body?.newPassword ?? body?.password
      if (typeof password !== 'string') return
      const check = meetsPolicy(password, await getPasswordPolicy())
      if (!check.ok) {
        throw new APIError('BAD_REQUEST', { message: policyErrorMessage(check) })
      }
    })
  },
  socialProviders: socialProviders(),
  plugins: [bearer()]
})
