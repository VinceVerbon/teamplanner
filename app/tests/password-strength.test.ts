// Test-set for F24's pure strength scorer: the same rubric drives the client-side
// meter and the server-side enforcement, so its behaviour is pinned down here.
import { describe, it, expect } from 'vitest'
import {
  passwordStrength, meetsPolicy, POLICY_MIN_STRENGTH, MIN_PASSWORD_LENGTH
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
