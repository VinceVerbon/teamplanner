// Test-set for F30 (team import from voetbal.nl: login replay + preview/import).
// Fixtures are distilled from a live capture of 2026-08-06 (see fixtures/voetbalnl/).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { createClub } from '../server/services/clubs'
import { createTeam, listTeams } from '../server/services/teams'
import {
  parseLoginForm, parseClubIdResponse, parseClubTeams,
  fetchClubTeams, previewTeamImport, importTeams,
  type Fetcher, type FetchLikeResponse
} from '../server/services/voetbalnl-import'
import { user } from '../server/db/schema'

const FIXTURES = join(__dirname, 'fixtures', 'voetbalnl')
const loginPage = readFileSync(join(FIXTURES, 'login-page.html'), 'utf8')
const teamsPage = readFileSync(join(FIXTURES, 'club-teams.html'), 'utf8')
const clubIdJson = readFileSync(join(FIXTURES, 'clubid-response.json'), 'utf8')

let admin: string
let outsider: string
let clubId: string

async function makeUser(email: string): Promise<string> {
  const [u] = await getDb().insert(user)
    .values({ name: email.split('@')[0]!, email, dateOfBirth: '1980-03-01' }).returning()
  return u!.id
}

beforeAll(async () => {
  await freshDb()
  admin = await makeUser('admin@example.com')
  outsider = await makeUser('outsider@example.com')
  await makeInstanceAdmin(admin)
  const club = await createClub(admin, { slug: 'fcaalsmeer', name: 'FC Aalsmeer' })
  clubId = club.id
  await createTeam(admin, clubId, 'MO17-4')
})

function resp(status: number, headers: Record<string, string> = {}, body = ''): FetchLikeResponse {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    headers: {
      get: name => map.get(name.toLowerCase()) ?? null,
      getSetCookie: () => map.has('set-cookie') ? [map.get('set-cookie')!] : []
    },
    text: async () => body
  }
}

/** Fake voetbal.nl that serves the fixtures; records calls for assertions. */
function fakeSite(overrides: Partial<Record<'login' | 'loginPost' | 'clubId' | 'teams', FetchLikeResponse>> = {}) {
  const calls: { url: string, method: string, cookie: string | null }[] = []
  const fetcher: Fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', cookie: init.headers?.Cookie || null })
    if (url.endsWith('/inloggen') && init.method === 'POST') {
      expect(init.body).toBeInstanceOf(FormData)
      const fd = init.body as FormData
      expect(fd.get('email')).toBe('vince@example.com')
      expect(fd.get('form_id')).toBe('login_form')
      expect(String(fd.get('form_build_id') ?? '')).not.toBe('')
      return overrides.loginPost ?? resp(303, {
        'location': 'http://www.voetbal.nl/profiel/overzicht',
        'set-cookie': 'SESS793a=abc123; path=/; HttpOnly'
      })
    }
    if (url.endsWith('/inloggen')) return overrides.login ?? resp(200, {}, loginPage)
    if (url.includes('/club/clubID/')) return overrides.clubId ?? resp(200, { 'content-type': 'application/json' }, clubIdJson)
    if (url.endsWith('/club/QLGN67W/teams')) return overrides.teams ?? resp(200, {}, teamsPage)
    throw new Error(`unexpected url: ${url}`)
  }
  return { fetcher, calls }
}

const CREDS = { email: 'vince@example.com', password: 'geheim' }

describe('F30 pure parsers', () => {
  it('extracts the hidden Drupal fields and submit value from the login form', () => {
    const fields = parseLoginForm(loginPage)
    expect(fields.form_id).toBe('login_form')
    expect(fields.form_build_id).toMatch(/^form-/)
    expect(fields.op).toContain('Inloggen')
  })

  it('throws 502 when the login form is not recognized (edge)', () => {
    expect(() => parseLoginForm('<html><body>niets</body></html>'))
      .toThrowError(expect.objectContaining({ statusCode: 502 }))
  })

  it('picks the club id from the lookup response', () => {
    expect(parseClubIdResponse(clubIdJson, 'FC Aalsmeer')).toBe('QLGN67W')
  })

  it('prefers the exact (case-insensitive) name match among candidates (edge)', () => {
    const json = JSON.stringify([
      { clubid: 'AAA1111', name: 'FC Aalsmeerderbrug', city: 'X' },
      { clubid: 'QLGN67W', name: 'fc aalsmeer', city: 'AALSMEER' }
    ])
    expect(parseClubIdResponse(json, 'FC Aalsmeer')).toBe('QLGN67W')
  })

  it('falls back to the first candidate without an exact match, null when empty (edge)', () => {
    const json = JSON.stringify([{ clubid: 'AAA1111', name: 'FC Aalsmeerderbrug' }])
    expect(parseClubIdResponse(json, 'FC Aalsmeer')).toBe('AAA1111')
    expect(parseClubIdResponse('[]', 'FC Aalsmeer')).toBeNull()
    expect(parseClubIdResponse('geen json', 'FC Aalsmeer')).toBeNull()
  })

  it('parses all teams with their Foldout category from the club teams page', () => {
    const rows = parseClubTeams(teamsPage, 'FC Aalsmeer')
    expect(rows).toHaveLength(71)
    const mo17 = rows.find(r => r.name === 'FC Aalsmeer MO17-4')
    expect(mo17).toMatchObject({
      voetbalnlId: 'T2105924066',
      category: 'Meiden onder 17 zaterdag',
      suggestedName: 'MO17-4'
    })
  })

  it('strips the club prefix and keeps lettered unique names as-is', () => {
    const rows = parseClubTeams(teamsPage, 'FC Aalsmeer')
    expect(rows.find(r => r.voetbalnlId === 'T1360538566')!.suggestedName).toBe('VR1')
    expect(rows.find(r => r.voetbalnlId === 'T24111303')!.suggestedName).toBe('O23-1')
  })

  it('disambiguates the bare club name and duplicate/letterless names with the category (edge)', () => {
    const rows = parseClubTeams(teamsPage, 'FC Aalsmeer')
    // first team is listed as just "FC Aalsmeer" -> "1" + category
    expect(rows.find(r => r.voetbalnlId === 'T2071170323')!.suggestedName).toBe('1 (Mannen zaterdag)')
    // "FC Aalsmeer 2" exists on zaterdag AND zondag
    expect(rows.find(r => r.voetbalnlId === 'T918748292')!.suggestedName).toBe('2 (Mannen zaterdag)')
    expect(rows.find(r => r.voetbalnlId === 'T910500798')!.suggestedName).toBe('2 (Mannen zondag)')
    // every suggestion is unique and long enough for createTeam
    const names = rows.map(r => r.suggestedName.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(rows.every(r => r.suggestedName.trim().length >= 2)).toBe(true)
  })

  it('returns no rows for a page without Foldout sections (edge)', () => {
    expect(parseClubTeams('<html><body>leeg</body></html>', 'FC Aalsmeer')).toEqual([])
  })
})

describe('F30 login replay (fake fetcher)', () => {
  it('logs in, forwards the session cookie and returns the parsed team list', async () => {
    const site = fakeSite()
    const rows = await fetchClubTeams(CREDS, 'FC Aalsmeer', site.fetcher)
    expect(rows).toHaveLength(71)
    expect(site.calls.map(c => `${c.method} ${c.url.replace('https://www.voetbal.nl', '')}`)).toEqual([
      'GET /inloggen',
      'POST /inloggen',
      'GET /club/clubID/FC%20Aalsmeer',
      'GET /club/QLGN67W/teams'
    ])
    // session cookie from the login response is sent on the follow-up requests
    expect(site.calls[2]!.cookie).toContain('SESS793a=abc123')
    expect(site.calls[3]!.cookie).toContain('SESS793a=abc123')
  })

  it('rejects with 401 when the login re-renders instead of redirecting (edge)', async () => {
    const site = fakeSite({ loginPost: resp(200, {}, loginPage) })
    await expect(fetchClubTeams(CREDS, 'FC Aalsmeer', site.fetcher))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects with 401 when the login redirects back to /inloggen (edge)', async () => {
    const site = fakeSite({ loginPost: resp(303, { location: 'https://www.voetbal.nl/inloggen' }) })
    await expect(fetchClubTeams(CREDS, 'FC Aalsmeer', site.fetcher))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects with 404 when the club lookup has no candidates (edge)', async () => {
    const site = fakeSite({ clubId: resp(200, {}, '[]') })
    await expect(fetchClubTeams(CREDS, 'FC Aalsmeer', site.fetcher))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects with 502 when the teams page has no recognizable teams (edge)', async () => {
    const site = fakeSite({ teams: resp(200, {}, '<html><body>leeg</body></html>') })
    await expect(fetchClubTeams(CREDS, 'FC Aalsmeer', site.fetcher))
      .rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('F30 preview + import', () => {
  it('flags suggestions that already exist as a team (case-insensitive)', async () => {
    const site = fakeSite()
    const { rows } = await previewTeamImport(admin, clubId, 'FC Aalsmeer', CREDS, site.fetcher)
    expect(rows.find(r => r.suggestedName === 'MO17-4')!.alreadyExists).toBe(true)
    expect(rows.find(r => r.suggestedName === 'MO15-1')!.alreadyExists).toBe(false)
  })

  it('requires club admin for preview and import (edge)', async () => {
    const site = fakeSite()
    await expect(previewTeamImport(outsider, clubId, 'FC Aalsmeer', CREDS, site.fetcher))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(importTeams(outsider, clubId, ['MO15-1']))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates selected teams, skipping existing names and duplicates in the payload', async () => {
    const res = await importTeams(admin, clubId, ['MO17-4', 'O12-1', 'o12-1', 'MO15-1'])
    expect(res).toEqual({ imported: 2, skipped: 2 })
    const names = (await listTeams(clubId)).map(t => t.name)
    expect(names).toContain('O12-1')
    expect(names).toContain('MO15-1')
    expect(names.filter(n => n.toLowerCase() === 'o12-1')).toHaveLength(1)
  })

  it('is idempotent: re-importing the same names skips everything (edge)', async () => {
    const res = await importTeams(admin, clubId, ['O12-1', 'MO15-1'])
    expect(res).toEqual({ imported: 0, skipped: 2 })
  })
})
