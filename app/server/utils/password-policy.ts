import { createError } from 'h3'
import { getDb } from './db'
import { clubs } from '../db/schema'
import {
  evaluatePassword, type PasswordPolicySpec
} from '../../shared/utils/password-strength'

export const DEFAULT_POLICY_SPEC: PasswordPolicySpec = { level: 'medium' }

/** The club's configured policy spec; the enforced default before a club exists. */
export async function getPasswordPolicySpec(): Promise<PasswordPolicySpec> {
  const [club] = await getDb().select({
    passwordPolicy: clubs.passwordPolicy,
    minLength: clubs.passwordCustomMinLength,
    requireLowercase: clubs.passwordCustomRequireLowercase,
    requireUppercase: clubs.passwordCustomRequireUppercase,
    requireDigit: clubs.passwordCustomRequireDigit,
    requireSymbol: clubs.passwordCustomRequireSymbol
  }).from(clubs).limit(1)
  if (!club) return DEFAULT_POLICY_SPEC
  if (club.passwordPolicy === 'custom') {
    return {
      level: 'custom',
      rules: {
        minLength: club.minLength,
        requireLowercase: club.requireLowercase,
        requireUppercase: club.requireUppercase,
        requireDigit: club.requireDigit,
        requireSymbol: club.requireSymbol
      }
    }
  }
  return { level: club.passwordPolicy }
}

/** Throws 400 when the password does not meet the active policy (F24). */
export async function assertPasswordAllowed(password: string): Promise<void> {
  const spec = await getPasswordPolicySpec()
  const result = evaluatePassword(password, spec)
  if (!result.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: `Wachtwoord voldoet niet aan het beleid: ${result.failures.join(', ')}`
    })
  }
}
