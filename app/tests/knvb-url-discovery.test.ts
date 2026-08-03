// Test-set for the F28 follow-up: KNVB kalender-URL discovery (scrape the stable
// landing page, tolerant slug->region mapping, admin-confirmed persistence) and the
// fetch pipeline running against the confirmed source set.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb, makeInstanceAdmin } from './setup'
import { getDb } from '../server/utils/db'
import { user } from '../server/db/schema'
import {
  KNVB_SOURCES, KNVB_SEASON, KNVB_LANDING_URL,
  discoverKnvbSources, getKnvbSources, saveKnvbSources, slugToRegion,
  type HtmlLoader, type KalenderRegion
} from '../server/services/knvb-sources'
import { fetchKalenders, listKalenders, type PdfLoader } from '../server/services/speeldagen'

const FIXTURES = join(__dirname, 'fixtures', 'knvb')

const htmlLoader = (fixture: string): HtmlLoader => async (url) => {
  expect(url).toBe(KNVB_LANDING_URL)
  return readFileSync(join(FIXTURES, fixture), 'utf8')
}

let sysAdmin: string
let member: string

beforeAll(async () => {
  await freshDb()
  const db = getDb()
  const mk = async (email: string) => {
    const [u] = await db.insert(user).values({ name: email.split('@')[0]!, email }).returning()
    return u!.id
  }
  sysAdmin = await mk('sys@example.com')
  member = await mk('member@example.com')
  await makeInstanceAdmin(sysAdmin)
})

describe('slugToRegion tolerant mapping', () => {
  it('maps current and historical slug variants', () => {
    expect(slugToRegion('speeldagenkalender-veld-landelijk-2026-2027')).toBe('landelijk')
    expect(slugToRegion('speeldagenkalender-veld-landelijk-jeugd-2026-2027')).toBe('landelijk-jeugd')
    expect(slugToRegion('speeldagenkalender-landelijke-jeugdcompetities-2024-2025')).toBe('landelijk-jeugd')
    expect(slugToRegion('speeldagenkalender-veld-noord-2026-2027')).toBe('noord')
    expect(slugToRegion('speeldagenkalender-veld-oost-2026-2027')).toBe('oost')
    expect(slugToRegion('speeldagenkalender-veld-west-2026-2027')).toBe('west')
    expect(slugToRegion('speeldagenkalender-veld-zuid-2026-2027')).toBe('zuid')
  })

  it('leaves combined or unknown regions to the admin (edge)', () => {
    expect(slugToRegion('speeldagenkalender-veld-noord-oost-2025-2026')).toBeNull()
    expect(slugToRegion('speeldagenkalender-veld-noordoost-2024-2025')).toBeNull()
    expect(slugToRegion('speeldagenkalender-iets-heel-anders-2026-2027')).toBeNull()
  })
})

describe('discovery - main flow (real landing-page markup)', () => {
  it('non-instance-admins cannot discover (edge)', async () => {
    await expect(discoverKnvbSources(member, htmlLoader('landing-2026-2027.html')))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('finds all six PDFs, mapped and absolutized, with the season', async () => {
    const res = await discoverKnvbSources(sysAdmin, htmlLoader('landing-2026-2027.html'))
    expect(res.season).toBe('2026/\'27')
    expect(res.discovered).toHaveLength(6)
    for (const seed of KNVB_SOURCES) {
      const match = res.discovered.find(d => d.url === seed.url)
      expect(match, seed.url).toBeDefined()
      expect(match!.region).toBe(seed.region)
    }
  })

  it('reports the currently configured set alongside (seed fallback here)', async () => {
    const res = await discoverKnvbSources(sysAdmin, htmlLoader('landing-2026-2027.html'))
    expect(res.current.configured).toBe(false)
    expect(res.current.sources).toEqual(KNVB_SOURCES)
  })

  it('a page without kalender links is a clear error, not an empty save (edge)', async () => {
    await expect(discoverKnvbSources(sysAdmin, async () => '<html><body>onderhoud</body></html>'))
      .rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('discovery - edge cases (historical page shapes)', () => {
  it('keeps only the newest season, dedupes, ignores season-less links, flags unmapped regions', async () => {
    const res = await discoverKnvbSources(sysAdmin, htmlLoader('landing-mixed-seasons.html'))
    expect(res.season).toBe('2025/\'26')
    // 5 unique links in the newest season: landelijk, jeugd-competities, noord-oost (deduped), west, zuid
    expect(res.discovered).toHaveLength(5)
    const byslug = (frag: string) => res.discovered.find(d => d.slug.includes(frag))!
    expect(byslug('jeugd-competities').region).toBe('landelijk-jeugd')
    expect(byslug('noord-oost').region).toBeNull() // combined region: admin chooses
    expect(byslug('-landelijk-2025').region).toBe('landelijk')
    // absolute URL stays intact, relative one is absolutized
    expect(byslug('jeugd-competities').url).toBe('https://www.knvb.nl/downloads/sites/bestand/knvb/29396/speeldagenkalender-veld-landelijk-jeugd-competities-2025-2026')
    expect(byslug('west').url.startsWith('https://www.knvb.nl/downloads/')).toBe(true)
    // 2024/'25 leftover and the season-less toelichting link are gone
    expect(res.discovered.some(d => d.slug.includes('2024'))).toBe(false)
    expect(res.discovered.some(d => d.slug.includes('toelichting'))).toBe(false)
  })
})

describe('confirmed sources - persistence and use', () => {
  it('falls back to the built-in seed while nothing is confirmed', async () => {
    const res = await getKnvbSources()
    expect(res.configured).toBe(false)
    expect(res.season).toBe(KNVB_SEASON)
    expect(res.sources).toEqual(KNVB_SOURCES)
  })

  it('non-instance-admins cannot save (edge)', async () => {
    await expect(saveKnvbSources(member, '2027/\'28', KNVB_SOURCES))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects empty sets, duplicate regions and non-KNVB URLs (edge)', async () => {
    await expect(saveKnvbSources(sysAdmin, '2027/\'28', []))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(saveKnvbSources(sysAdmin, '2027/\'28', [
      { region: 'west', url: 'https://www.knvb.nl/downloads/a' },
      { region: 'west', url: 'https://www.knvb.nl/downloads/b' }
    ])).rejects.toMatchObject({ statusCode: 400 })
    await expect(saveKnvbSources(sysAdmin, '2027/\'28', [
      { region: 'west', url: 'https://evil.example.com/kalender.pdf' }
    ])).rejects.toMatchObject({ statusCode: 400 })
    await expect(saveKnvbSources(sysAdmin, '2027/\'28', [
      { region: 'ergens' as KalenderRegion, url: 'https://www.knvb.nl/downloads/a' }
    ])).rejects.toMatchObject({ statusCode: 400 })
  })

  it('a confirmed set replaces the seed', async () => {
    const next = KNVB_SOURCES.map(s => ({
      region: s.region,
      url: s.url.replace(/knvb\/\d+\//, 'knvb/31000/').replace('2026-2027', '2027-2028')
    }))
    const saved = await saveKnvbSources(sysAdmin, '2027/\'28', next)
    expect(saved.configured).toBe(true)
    expect(saved.season).toBe('2027/\'28')
    expect(saved.sources).toHaveLength(6)
    const again = await getKnvbSources()
    expect(again.configured).toBe(true)
    expect(again.sources.map(s => s.url).every(u => u.includes('2027-2028'))).toBe(true)
  })

  it('fetchKalenders downloads from the confirmed URLs and stamps their season', async () => {
    const requested: string[] = []
    const loader: PdfLoader = async (url) => {
      requested.push(url)
      const region = slugToRegion(url.split('/').pop()!)!
      return new Uint8Array(readFileSync(join(FIXTURES, `${region}.pdf`)))
    }
    const results = await fetchKalenders(sysAdmin, loader)
    expect(results).toHaveLength(6)
    expect(results.every(r => r.status === 'pending-new')).toBe(true)
    const { sources } = await getKnvbSources()
    expect(requested.sort()).toEqual(sources.map(s => s.url).sort())
    const list = await listKalenders()
    expect(list.every(k => k.season === '2027/\'28')).toBe(true)
  })

  it('saving again replaces the whole set, not appends (edge)', async () => {
    const saved = await saveKnvbSources(sysAdmin, '2028/\'29', [
      { region: 'west', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/32000/speeldagenkalender-veld-west-2028-2029' }
    ])
    expect(saved.sources).toHaveLength(1)
    expect((await getKnvbSources()).sources).toHaveLength(1)
  })
})
