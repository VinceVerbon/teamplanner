// F24: rule-based password strength scoring. Pure and deterministic so the exact same
// rubric runs client-side (live meter) and server-side (enforcement).

export type PasswordPolicy = 'low' | 'medium' | 'strong'

/** 0 = blocked (too short / common), 1 = weak, 2 = medium, 3 = strong. */
export type PasswordStrength = 0 | 1 | 2 | 3

export const MIN_PASSWORD_LENGTH = 8

// Exact matches only (case-insensitive): passwords nobody may use regardless of policy.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'wachtwoord', 'wachtwoord1', 'welkom01',
  'welkom123', 'qwerty123', 'qwertyuiop', '12345678', '123456789', '1234567890',
  'iloveyou', 'sunshine', 'football', 'baseball', 'superman', 'dragon123',
  'letmein1', 'trustno1', 'admin123', 'welcome1', 'monkey123', 'abc12345'
])

function characterClasses(password: string): number {
  let classes = 0
  if (/[a-z]/.test(password)) classes++
  if (/[A-Z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^a-zA-Z0-9]/.test(password)) classes++
  return classes
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 0
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 0
  if (/^(.)\1+$/.test(password)) return 0 // one repeated character
  const classes = characterClasses(password)
  let points = 0
  if (password.length >= 10) points++
  if (password.length >= 12) points++
  if (password.length >= 16) points++
  if (classes >= 2) points++
  if (classes >= 3) points++
  if (classes >= 4) points++
  if (points <= 1) return 1
  if (points <= 3) return 2
  return 3
}

/** Minimum strength a password must reach under each policy level. */
export const POLICY_MIN_STRENGTH: Record<PasswordPolicy, PasswordStrength> = {
  low: 1,
  medium: 2,
  strong: 3
}

export const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: 'onbruikbaar',
  1: 'zwak',
  2: 'gemiddeld',
  3: 'sterk'
}

export interface PolicyCheck {
  ok: boolean
  strength: PasswordStrength
  required: PasswordStrength
}

export function meetsPolicy(password: string, policy: PasswordPolicy): PolicyCheck {
  const strength = passwordStrength(password)
  const required = POLICY_MIN_STRENGTH[policy]
  return { ok: strength >= required, strength, required }
}

export function policyErrorMessage(check: PolicyCheck): string {
  return `Wachtwoord is te zwak (${STRENGTH_LABELS[check.strength]}); vereist is minimaal `
    + `'${STRENGTH_LABELS[check.required]}'. Gebruik minimaal ${MIN_PASSWORD_LENGTH} tekens; `
    + `langer en met hoofdletters, cijfers of leestekens is sterker.`
}

// --- 'aangepast' (custom) policy: explicit rules instead of the scored levels ---

export interface CustomPasswordRules {
  minLength: number
  requireLowercase: boolean
  requireUppercase: boolean
  requireDigit: boolean
  requireSymbol: boolean
}

/** The stored club setting: a scored level or 'custom'. */
export type PasswordPolicySetting = PasswordPolicy | 'custom'

export type PasswordPolicySpec
  = { level: PasswordPolicy }
    | { level: 'custom', rules: CustomPasswordRules }

export interface PasswordCheckResult {
  ok: boolean
  /** Dutch, ready for display; empty when ok. */
  failures: string[]
}

/** Common passwords stay blocked under every policy, custom included. */
export function checkCustomRules(password: string, rules: CustomPasswordRules): PasswordCheckResult {
  const failures: string[] = []
  if (password.length < rules.minLength) failures.push(`minimaal ${rules.minLength} tekens`)
  if (COMMON_PASSWORDS.has(password.toLowerCase())) failures.push('geen veelgebruikt wachtwoord')
  if (rules.requireLowercase && !/[a-z]/.test(password)) failures.push('minimaal een kleine letter')
  if (rules.requireUppercase && !/[A-Z]/.test(password)) failures.push('minimaal een hoofdletter')
  if (rules.requireDigit && !/[0-9]/.test(password)) failures.push('minimaal een cijfer')
  if (rules.requireSymbol && !/[^a-zA-Z0-9]/.test(password)) failures.push('minimaal een leesteken')
  return { ok: failures.length === 0, failures }
}

/** One evaluator for every policy shape (levels and custom). */
export function evaluatePassword(password: string, spec: PasswordPolicySpec): PasswordCheckResult {
  if (spec.level === 'custom') return checkCustomRules(password, spec.rules)
  const check = meetsPolicy(password, spec.level)
  return { ok: check.ok, failures: check.ok ? [] : [policyErrorMessage(check)] }
}

/**
 * Heuristic for the are-you-sure dialog: build the weakest password the custom rules
 * still accept and score it - if that scores below 'medium', the custom policy is
 * weaker than the standard.
 */
export function customWeakerThanMedium(rules: CustomPasswordRules): boolean {
  let sample = ''
  if (rules.requireLowercase) sample += 'x'
  if (rules.requireUppercase) sample += 'X'
  if (rules.requireDigit) sample += '7'
  if (rules.requireSymbol) sample += '!'
  // Vary the filler: an all-same-character sample would trip the repeated-char block
  // and make every rule set look weak.
  const filler = 'abcdefghijklmnopqrstuvwxyz'
  for (let i = 0; sample.length < rules.minLength; i++) sample += filler[i % filler.length]
  return passwordStrength(sample) < POLICY_MIN_STRENGTH.medium
}
