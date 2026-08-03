import { createError } from 'h3'
import { getDb } from '../utils/db'
import { requireInstanceAdmin } from './instance'
import { knvbSources } from '../db/schema-knvb'

// F28 follow-up: the speeldagenkalender PDF URLs change unpredictably every season
// (CMS asset IDs, slugs, even the SET of regions - see docs/research-knvb-url-discovery.md).
// The KNVB landing page itself has been stable for three seasons, so sources are
// DISCOVERED by scraping that page and only replace the configured set after the
// instance admin confirms them. The built-in seed below stays as fallback so the app
// never depends on the scrape (or on KNVB cooperation) to keep working.

export type KalenderRegion = 'landelijk' | 'landelijk-jeugd' | 'noord' | 'oost' | 'west' | 'zuid'

export const KALENDER_REGIONS: KalenderRegion[] = [
  'landelijk', 'landelijk-jeugd', 'noord', 'oost', 'west', 'zuid'
]

export const KNVB_SEASON = '2026/\'27'

export const KNVB_SOURCES: { region: KalenderRegion, url: string }[] = [
  { region: 'landelijk', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29859/speeldagenkalender-veld-landelijk-2026-2027' },
  { region: 'landelijk-jeugd', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29860/speeldagenkalender-veld-landelijk-jeugd-2026-2027' },
  { region: 'noord', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29861/speeldagenkalender-veld-noord-2026-2027' },
  { region: 'oost', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29862/speeldagenkalender-veld-oost-2026-2027' },
  { region: 'west', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29863/speeldagenkalender-veld-west-2026-2027' },
  { region: 'zuid', url: 'https://www.knvb.nl/downloads/sites/bestand/knvb/29864/speeldagenkalender-veld-zuid-2026-2027' }
]

export const KNVB_LANDING_URL = 'https://www.knvb.nl/assist-wedstrijdsecretarissen/veldvoetbal/seizoensplanning/speeldagenkalenders'

export type HtmlLoader = (url: string) => Promise<string>

const defaultHtmlLoader: HtmlLoader = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Ophalen mislukt (${res.status}) voor ${url}`)
  return res.text()
}

export interface DiscoveredSource {
  url: string
  slug: string
  season: string
  /** null = slug did not map to a known region; the admin must choose one. */
  region: KalenderRegion | null
}

/** Tolerant slug -> region mapping, most specific first. History shows slugs change
 * per season (noordoost vs noord-oost, jeugd variants), so match on fragments and
 * leave anything unrecognized to the admin instead of erroring. */
export function slugToRegion(slug: string): KalenderRegion | null {
  const s = slug.toLowerCase()
  if (s.includes('jeugd')) return 'landelijk-jeugd'
  if (s.includes('noord-oost') || s.includes('noordoost')) return null // combined region: admin chooses
  if (s.includes('noord')) return 'noord'
  if (s.includes('oost')) return 'oost'
  if (s.includes('west')) return 'west'
  if (s.includes('zuid')) return 'zuid'
  if (s.includes('landelijk')) return 'landelijk'
  return null
}

function seasonFromSlug(slug: string): { startYear: number, season: string } | null {
  const m = slug.match(/(\d{4})-(\d{4})$/)
  if (!m) return null
  return { startYear: Number(m[1]), season: `${m[1]}/'${m[2]!.slice(2)}` }
}

/** Scrape the landing page for speeldagenkalender download links; keep the newest
 * season only. Instance admin action; nothing is persisted here. */
export async function discoverKnvbSources(requesterId: string, loadHtml: HtmlLoader = defaultHtmlLoader) {
  await requireInstanceAdmin(requesterId)
  const html = await loadHtml(KNVB_LANDING_URL)
  const found = new Map<string, DiscoveredSource & { startYear: number }>()
  for (const m of html.matchAll(/href="([^"]*\/downloads\/sites\/bestand\/[^"]*speeldagenkalender[^"]*)"/gi)) {
    const href = m[1]!.replace(/&amp;/g, '&')
    const url = href.startsWith('http') ? href : `https://www.knvb.nl${href}`
    const slug = url.split('/').pop()!
    const parsed = seasonFromSlug(slug)
    if (!parsed) continue // kalender link without a season suffix: not a season PDF
    found.set(url, { url, slug, season: parsed.season, startYear: parsed.startYear, region: slugToRegion(slug) })
  }
  if (found.size === 0) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Geen speeldagenkalender-links gevonden op de KNVB-pagina (pagina-opbouw gewijzigd?)'
    })
  }
  const newest = Math.max(...[...found.values()].map(s => s.startYear))
  const discovered = [...found.values()]
    .filter(s => s.startYear === newest)
    .map(({ startYear: _startYear, ...s }) => s)
    .sort((a, b) => a.slug.localeCompare(b.slug))
  const current = await getKnvbSources()
  return { season: discovered[0]!.season, discovered, current }
}

/** The sources fetch/force-reload run against: admin-confirmed set when present,
 * the built-in seed otherwise. */
export async function getKnvbSources(): Promise<{
  season: string
  sources: { region: KalenderRegion, url: string }[]
  configured: boolean
}> {
  const rows = await getDb().select().from(knvbSources).orderBy(knvbSources.region)
  if (rows.length === 0) return { season: KNVB_SEASON, sources: KNVB_SOURCES, configured: false }
  return {
    season: rows[0]!.season,
    sources: rows.map(r => ({ region: r.region as KalenderRegion, url: r.url })),
    configured: true
  }
}

/** Persist the admin-confirmed source set (replaces the whole set). */
export async function saveKnvbSources(
  requesterId: string, season: string,
  sources: { region: KalenderRegion, url: string }[]
) {
  await requireInstanceAdmin(requesterId)
  if (!season.trim()) throw createError({ statusCode: 400, statusMessage: 'Seizoen ontbreekt' })
  if (sources.length === 0) throw createError({ statusCode: 400, statusMessage: 'Geen bronnen om op te slaan' })
  const seen = new Set<string>()
  for (const s of sources) {
    if (!KALENDER_REGIONS.includes(s.region)) {
      throw createError({ statusCode: 400, statusMessage: `Onbekende regio: ${s.region}` })
    }
    if (seen.has(s.region)) {
      throw createError({ statusCode: 400, statusMessage: `Regio ${s.region} komt dubbel voor` })
    }
    seen.add(s.region)
    if (!/^https:\/\/www\.knvb\.nl\//.test(s.url)) {
      throw createError({ statusCode: 400, statusMessage: `Geen KNVB-URL: ${s.url}` })
    }
  }
  const db = getDb()
  await db.delete(knvbSources)
  await db.insert(knvbSources).values(sources.map(s => ({ season, region: s.region, url: s.url })))
  return getKnvbSources()
}
