// F5 age rules - pure, testable functions (see Build spec in docs/FEATURES.md).
// dateOfBirth is stored as a 'YYYY-MM-DD' date string; 'on' defaults to today.

export const SELF_MANAGE_AGE = 15
export const ADULT_AGE = 18

export function ageOn(dateOfBirth: string, on: Date = new Date()): number {
  const dob = new Date(dateOfBirth)
  let age = on.getFullYear() - dob.getFullYear()
  const beforeBirthday
    = on.getMonth() < dob.getMonth()
      || (on.getMonth() === dob.getMonth() && on.getDate() < dob.getDate())
  if (beforeBirthday) age--
  return age
}

/**
 * May the player manage their own attendance?
 * 15+ -> always. Under 15 -> only with the per-account opt-in checkmark
 * (set by a linked parent or an admin, not by the child).
 * No date of birth -> not a player (DOB is required at player registration); treat as adult.
 */
export function canSelfManageAttendance(
  dateOfBirth: string | null,
  selfManageOptIn: boolean,
  on: Date = new Date()
): boolean {
  if (!dateOfBirth) return true
  return ageOn(dateOfBirth, on) >= SELF_MANAGE_AGE || selfManageOptIn
}

/**
 * May an ACTIVE linked parent manage this player's attendance?
 * Under 18 -> always. 18+ -> only if the player re-enabled it
 * ("mijn ouder mag mijn aanwezigheid beheren"). No DOB -> treat as adult.
 */
export function canParentManageAttendance(
  dateOfBirth: string | null,
  parentManageOptIn: boolean,
  on: Date = new Date()
): boolean {
  if (!dateOfBirth) return parentManageOptIn
  return ageOn(dateOfBirth, on) < ADULT_AGE || parentManageOptIn
}
