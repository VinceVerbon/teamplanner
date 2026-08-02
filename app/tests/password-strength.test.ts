// Test-set for F24's pure strength scorer: the same rubric drives the client-side
// meter and the server-side enforcement, so its behaviour is pinned down here.
import { describe, it, expect } from 'vitest'
import {
  passwordStrength, meetsPolicy, POLICY_MIN_STRENGTH, MIN_PASSWORD_LENGTH,
  checkCustomRules, evaluatePassword, customWeakerThanMedium, type CustomPasswordRules
} from '../shared/utils/password-strength'

describe('passwordStrength - blocked (0)', () => {
  it('rejects anything under the minimum length', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('Ab1!')).toBe(0)
    expect(passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(0)
  })

  it('rejects common passwords regardless of casing', () => {
    expect(passwordStrength('password1')).toBe(0)
    expect(passwordStrength('PASSWORD1')).toBe(0)
    expect(passwordStrength('Wachtwoord1')).toBe(0)
    expect(passwordStrength('12345678')).toBe(0)
  })

  it('rejects a single repeated character even when long (edge)', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBe(0)
  })
})

describe('passwordStrength - weak (1)', () => {
  it('scores short single-class passwords weak', () => {
    expect(passwordStrength('abcdefgh')).toBe(1) // 8 lowercase
    expect(passwordStrength('abcdefghij')).toBe(1) // 10 lowercase: one point
    expect(passwordStrength('abcdef12')).toBe(1) // 8 chars, only 2 classes
  })
})

describe('passwordStrength - medium (2)', () => {
  it('scores short multi-class passwords medium', () => {
    expect(passwordStrength('Abcdef12')).toBe(2) // 8 chars, 3 classes
  })

  it('scores a longer single-class password medium', () => {
    expect(passwordStrength('abcdefghijkl')).toBe(2) // 12 lowercase: 2 length points
  })
})

describe('passwordStrength - strong (3)', () => {
  it('scores long passphrases strong', () => {
    expect(passwordStrength('correct-horse-battery')).toBe(3)
  })

  it('scores long multi-class passwords strong', () => {
    expect(passwordStrength('Stevig-Wachtwoord-2026!')).toBe(3)
  })
})

describe('meetsPolicy', () => {
  it('low accepts weak but not blocked', () => {
    expect(meetsPolicy('abcdefgh', 'low').ok).toBe(true)
    expect(meetsPolicy('password1', 'low').ok).toBe(false)
    expect(meetsPolicy('short', 'low').ok).toBe(false)
  })

  it('medium (the default standard) rejects weak', () => {
    expect(meetsPolicy('abcdefgh', 'medium').ok).toBe(false)
    expect(meetsPolicy('Abcdef12', 'medium').ok).toBe(true)
    expect(meetsPolicy('correct-horse-battery', 'medium').ok).toBe(true)
  })

  it('strong rejects medium', () => {
    expect(meetsPolicy('Abcdef12', 'strong').ok).toBe(false)
    expect(meetsPolicy('Stevig-Wachtwoord-2026!', 'strong').ok).toBe(true)
  })

  it('policy thresholds are ordered low < medium < strong (edge)', () => {
    expect(POLICY_MIN_STRENGTH.low).toBeLessThan(POLICY_MIN_STRENGTH.medium)
    expect(POLICY_MIN_STRENGTH.medium).toBeLessThan(POLICY_MIN_STRENGTH.strong)
  })
})

const rules = (over: Partial<CustomPasswordRules> = {}): CustomPasswordRules => ({
  minLength: 8, requireLowercase: false, requireUppercase: false,
  requireDigit: false, requireSymbol: false, ...over
})

describe('custom rules (aangepast)', () => {
  it('enforces the minimum length', () => {
    expect(checkCustomRules('kortkort', rules({ minLength: 10 })).ok).toBe(false)
    expect(checkCustomRules('langgenoeg', rules({ minLength: 10 })).ok).toBe(true)
  })

  it('enforces each required character element independently', () => {
    const all = rules({ requireLowercase: true, requireUppercase: true, requireDigit: true, requireSymbol: true })
    const result = checkCustomRules('alleenkleineletters', all)
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(3) // missing upper, digit, symbol
    expect(checkCustomRules('Voldoet-Aan-Alles-8', all).ok).toBe(true)
  })

  it('common passwords stay blocked even under permissive custom rules (edge)', () => {
    expect(checkCustomRules('password1', rules()).ok).toBe(false)
  })

  it('evaluatePassword routes levels and custom through one API', () => {
    expect(evaluatePassword('abcdefgh', { level: 'medium' }).ok).toBe(false)
    expect(evaluatePassword('abcdefgh', { level: 'custom', rules: rules() }).ok).toBe(true)
    expect(evaluatePassword('abc', { level: 'custom', rules: rules() }).failures.length).toBeGreaterThan(0)
  })
})

describe('customWeakerThanMedium (drives the are-you-sure dialog)', () => {
  it('bare 8-char rules are weaker than the standard', () => {
    expect(customWeakerThanMedium(rules())).toBe(true)
  })

  it('8 chars with three required elements matches the standard', () => {
    expect(customWeakerThanMedium(rules({
      requireLowercase: true, requireUppercase: true, requireDigit: true
    }))).toBe(false)
  })

  it('a long minimum length alone matches the standard (edge)', () => {
    expect(customWeakerThanMedium(rules({ minLength: 12 }))).toBe(false)
    expect(customWeakerThanMedium(rules({ minLength: 10 }))).toBe(true)
  })
})
