import { createError } from 'h3'
import { getDb } from './db'
import { clubs } from '../db/schema'
import {
  meetsPolicy, policyErrorMessage, type PasswordPolicy
} from '../../shared/utils/password-strength'

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = 'medium'

/** The club's configured policy; the enforced default before a club exists. */
export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const [club] = await getDb().select({ passwordPolicy: clubs.passwordPolicy }).from(clubs).limit(1)
  return club?.passwordPolicy ?? DEFAULT_PASSWORD_POLICY
}

/** Throws 400 when the password does not meet the active policy (F24). */
export async function assertPasswordAllowed(password: string): Promise<void> {
  const policy = await getPasswordPolicy()
  const check = meetsPolicy(password, policy)
  if (!check.ok) {
    throw createError({ statusCode: 400, statusMessage: policyErrorMessage(check) })
  }
}
