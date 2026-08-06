import { createError } from 'h3'
import { getUserRoles, isClubAdmin } from '../utils/roles'
import { listTeams, createTeam } from './teams'

// F30: team import from voetbal.nl. The admin replays the site's "team volgen"
// flow with their OWN voetbal.nl login: credentials are used in-memory for this
// single action and never stored. Chain (verified against a live capture,
// fixtures in tests/fixtures/voetbalnl/):
//   GET  /inloggen                     -> hidden Drupal form fields + cookies
//   POST /inloggen (multipart)         -> 303 + session cookie on success
//   GET  /club/clubID/<name>           -> [{ clubid, name, city }, ...]
//   GET  /club/<clubid>/teams          -> Foldout sections with FollowBlock teams
// All endpoints except the login page 302 to /inloggen without a session.
// Manual team creation stays the fallback: the markup can change any season.

const BASE = 'https://www.voetbal.nl'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

export interface VoetbalnlCredentials {
  email: string
  password: string
}

export interface VoetbalnlTeam {
  /** voetbal.nl team id, e.g. T702371187 (display/traceability only; teams have no external-uid column) */
  voetbalnlId: string
  /** name as shown on voetbal.nl, e.g. "FC Aalsmeer MO17-4" */
  name: string
  /** Foldout section title, e.g. "Meiden onder 17 zaterdag" */
  category: string
  /** proposed teamplanner name, e.g. "MO17-4" (club prefix stripped, disambiguated) */
  suggestedName: string
}

/** Minimal structural response type so tests can fake the fetcher. */
export interface FetchLikeResponse {
  status: number
  headers: { get(name: string): string | null, getSetCookie?(): string[] }
  text(): Promise<string>
}
export type Fetcher = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: FormData
  redirect?: 'manual'
}) => Promise<FetchLikeResponse>

const defaultFetcher: Fetcher = (url, init) => fetch(url, { ...init, redirect: 'manual' })

async function requireAdmin(userId: string, clubId: string) {
  const roles = await getUserRoles(userId)
  if (!isClubAdmin(roles, clubId)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin role required' })
  }
}

// --- pure parsers (exported for tests) ---

/** Hidden inputs + submit button of the Drupal login form; echoed back on POST. */
export function parseLoginForm(html: string): Record<string, string> {
  const form = html.match(/<form[^>]*id="login-form"[\s\S]*?<\/form>/)?.[0]
  if (!form) {
    throw createError({ statusCode: 502, statusMessage: 'Inlogformulier van voetbal.nl niet herkend (pagina-opbouw gewijzigd?)' })
  }
  const fields: Record<string, string> = {}
  for (const tag of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = tag[0].match(/name="([^"]*)"/)?.[1]
    if (name) fields[name] = tag[0].match(/value="([^"]*)"/)?.[1] ?? ''
  }
  const submit = form.match(/<button[^>]*type="submit"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/)
  if (submit) fields[submit[1]!] = submit[2]!
  return fields
}

/** Pick the club id out of the /club/clubID/<name> JSON (array of candidates). */
export function parseClubIdResponse(json: string, clubName: string): string | null {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const candidates = rows.filter((r): r is { clubid: string, name: string } =>
    !!r && typeof r === 'object' && typeof (r as { clubid?: unknown }).clubid === 'string')
  const exact = candidates.find(r => r.name?.toLowerCase() === clubName.toLowerCase())
  return (exact ?? candidates[0])?.clubid ?? null
}

/** Strip the club prefix off a voetbal.nl team name and make it usable as a
 * teamplanner name: "FC Aalsmeer MO17-4" -> "MO17-4", first team "FC Aalsmeer"
 * -> "1". Names without letters ("2", "35+1") or duplicated across sections
 * (zaterdag vs zondag) get the category appended so every suggestion is unique
 * and passes the >= 2 chars rule of createTeam. */
export function parseClubTeams(html: string, clubName: string): VoetbalnlTeam[] {
  const rows: VoetbalnlTeam[] = []
  const sections = html.split(/<div class="Foldout-item"/).slice(1)
  for (const section of sections) {
    const category = section.match(/Foldout-title"><h4>([^<]+)<\/h4>/)?.[1]?.trim() ?? ''
    for (const item of section.matchAll(/FollowBlock-item" data-team-id="(T\d+)"[\s\S]*?FollowBlock-name">([^<]+)</g)) {
      const name = item[2]!.trim()
      let stripped = name.toLowerCase().startsWith(clubName.toLowerCase())
        ? name.slice(clubName.length).trim()
        : name
      if (!stripped) stripped = '1'
      rows.push({ voetbalnlId: item[1]!, name, category, suggestedName: stripped })
    }
  }
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = row.suggestedName.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const row of rows) {
    const ambiguous = (counts.get(row.suggestedName.toLowerCase()) ?? 0) > 1
    if ((ambiguous || !/[a-z]/i.test(row.suggestedName)) && row.category) {
      row.suggestedName = `${row.suggestedName} (${row.category})`
    }
  }
  return rows
}

// --- login replay ---

class CookieJar {
  private jar = new Map<string, string>()
  store(res: FetchLikeResponse) {
    const cookies = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
    for (const cookie of cookies) {
      const [pair] = cookie.split(';')
      const eq = pair!.indexOf('=')
      if (eq > 0) this.jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim())
    }
  }

  header() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

/** Log in as the admin and fetch their club's team list. Credentials live only
 * in this call's scope. */
export async function fetchClubTeams(creds: VoetbalnlCredentials, clubName: string, fetcher: Fetcher = defaultFetcher): Promise<VoetbalnlTeam[]> {
  const jar = new CookieJar()
  const go = async (url: string, init: Parameters<Fetcher>[1] = {}) => {
    const res = await fetcher(url, {
      redirect: 'manual',
      ...init,
      headers: { 'User-Agent': USER_AGENT, 'Cookie': jar.header(), ...init.headers }
    })
    jar.store(res)
    return res
  }

  const loginPage = await go(`${BASE}/inloggen`)
  const formFields = parseLoginForm(await loginPage.text())

  const body = new FormData()
  body.set('email', creds.email)
  body.set('password', creds.password)
  for (const [name, value] of Object.entries(formFields)) body.set(name, value)
  const login = await go(`${BASE}/inloggen`, { method: 'POST', body })
  // success = redirect away from the login page; failure re-renders it (200)
  if (login.status < 300 || login.status >= 400 || (login.headers.get('location') ?? '').includes('/inloggen')) {
    throw createError({ statusCode: 401, statusMessage: 'Inloggen bij voetbal.nl is niet gelukt; controleer e-mailadres en wachtwoord' })
  }

  const clubRes = await go(`${BASE}/club/clubID/${encodeURIComponent(clubName)}`, {
    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  })
  const clubId = clubRes.status === 200 ? parseClubIdResponse(await clubRes.text(), clubName) : null
  if (!clubId) {
    throw createError({ statusCode: 404, statusMessage: `Club "${clubName}" is niet gevonden op voetbal.nl` })
  }

  const teamsRes = await go(`${BASE}/club/${clubId}/teams`)
  if (teamsRes.status !== 200) {
    throw createError({ statusCode: 502, statusMessage: 'Teampagina van voetbal.nl kon niet worden opgehaald' })
  }
  const rows = parseClubTeams(await teamsRes.text(), clubName)
  if (rows.length === 0) {
    throw createError({ statusCode: 502, statusMessage: 'Geen teams gevonden op de voetbal.nl-teampagina (pagina-opbouw gewijzigd?)' })
  }
  return rows
}

// --- preview / import (F21 pattern) ---

export async function previewTeamImport(requesterId: string, clubId: string, clubName: string, creds: VoetbalnlCredentials, fetcher: Fetcher = defaultFetcher) {
  await requireAdmin(requesterId, clubId)
  const rows = await fetchClubTeams(creds, clubName, fetcher)
  const existing = new Set((await listTeams(clubId, { includeArchived: true })).map(t => t.name.toLowerCase()))
  return {
    rows: rows.map(row => ({ ...row, alreadyExists: existing.has(row.suggestedName.toLowerCase()) }))
  }
}

export async function importTeams(requesterId: string, clubId: string, names: string[]) {
  await requireAdmin(requesterId, clubId)
  const existing = new Set((await listTeams(clubId, { includeArchived: true })).map(t => t.name.toLowerCase()))
  let imported = 0
  let skipped = 0
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (existing.has(key)) {
      skipped++
      continue
    }
    await createTeam(requesterId, clubId, name)
    existing.add(key)
    imported++
  }
  return { imported, skipped }
}
