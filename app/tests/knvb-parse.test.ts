// Test-set for the F28 KNVB kalender parser. The fixture PDFs are the real published
// 2026/'27 speeldagenkalenders; the date assertions below were transcribed from the
// rendered PDFs by hand, so a parse that drifts from the source fails here (the F28
// requirement: dates in the DB must match the dates in the PDFs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDayLabel, parseKalenderItems, type ParsedKalender } from '../server/utils/knvb-kalender'
import { extractPdfTextItems } from '../server/utils/knvb-pdf'

const FIXTURES = join(__dirname, 'fixtures', 'knvb')

async function parseFixture(name: string): Promise<ParsedKalender> {
  const data = new Uint8Array(readFileSync(join(FIXTURES, `${name}.pdf`)))
  const pages = await extractPdfTextItems(data)
  return parseKalenderItems(pages[0]!)
}

describe('parseDayLabel', () => {
  it('parses weekend labels', () => {
    expect(parseDayLabel('15 / 16 aug. 2026')).toEqual({ dateStart: '2026-08-15', dateEnd: '2026-08-16' })
    expect(parseDayLabel('5 / 6 sept. 2026')).toEqual({ dateStart: '2026-09-05', dateEnd: '2026-09-06' })
  })

  it('parses month-crossing weekends (edge)', () => {
    expect(parseDayLabel('31 okt. / 1 nov. 2026')).toEqual({ dateStart: '2026-10-31', dateEnd: '2026-11-01' })
  })

  it('parses single days with weekday prefixes', () => {
    expect(parseDayLabel('zat. 27 mrt. 2027')).toEqual({ dateStart: '2027-03-27', dateEnd: null })
    expect(parseDayLabel('Don. 6 mei 2027')).toEqual({ dateStart: '2027-05-06', dateEnd: null })
  })

  it('parses ranges', () => {
    expect(parseDayLabel('1 - 3 juni 2027')).toEqual({ dateStart: '2027-06-01', dateEnd: '2027-06-03' })
    expect(parseDayLabel('8 -10 juni 2027')).toEqual({ dateStart: '2027-06-08', dateEnd: '2027-06-10' })
  })

  it('tolerates the source typo "au.g" and compact slashes (edge)', () => {
    expect(parseDayLabel('08/09 au.g 2026')).toEqual({ dateStart: '2026-08-08', dateEnd: '2026-08-09' })
    expect(parseDayLabel('15/ 16 aug. 2026')).toEqual({ dateStart: '2026-08-15', dateEnd: '2026-08-16' })
  })

  it('rejects non-date text (edge)', () => {
    expect(parseDayLabel('Algemeen')).toBeNull()
    expect(parseDayLabel('WD = wedstrijddag')).toBeNull()
    expect(parseDayLabel('Kerstvakantie')).toBeNull()
  })
})

describe('west kalender (district, landscape matrix)', () => {
  it('parses title, 13 category columns and the full season of speeldagen', async () => {
    const west = await parseFixture('west')
    expect(west.title).toContain('West I en II')
    expect(west.title).toContain('2026/\'27')
    expect(west.columns).toHaveLength(13)
    expect(west.columns[0]).toContain('Schema 14')
    expect(west.columns[0]).toContain('Categorie A')
    expect(west.columns[12]).toContain('Toernooi')
    // Season runs mid-August 2026 to end of June 2027.
    expect(west.days[0]!.label).toBe('15 / 16 aug. 2026')
    expect(west.days[0]!.dateStart).toBe('2026-08-15')
    expect(west.days[west.days.length - 1]!.dateStart >= '2027-06-01').toBe(true)
    expect(west.days.length).toBeGreaterThanOrEqual(40)
  })

  it('dates match the PDF exactly for the transcribed 2026 rows', async () => {
    const west = await parseFixture('west')
    const transcribed2026 = [
      '2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12',
      '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17',
      '2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21',
      '2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19'
    ]
    const parsed2026 = west.days.map(d => d.dateStart).filter(d => d.startsWith('2026-'))
    expect(parsed2026).toEqual(transcribed2026)
  })

  it('special rows carry the right single dates (edge)', async () => {
    const west = await parseFixture('west')
    const paas = west.days.find(d => d.label.includes('27 mrt'))!
    expect(paas.dateStart).toBe('2027-03-27')
    expect(paas.remark).toContain('Paas')
    const hemelvaart = west.days.find(d => d.label.includes('6 mei'))!
    expect(hemelvaart.dateStart).toBe('2027-05-06')
  })

  it('cells land in the right columns (spot checks against the PDF)', async () => {
    const west = await parseFixture('west')
    const aug29 = west.days.find(d => d.label === '29 / 30 aug. 2026')!
    expect(aug29.cells[0]).toBe('Beker poule') // Schema 14 Cat A
    expect(aug29.cells[4]).toBe('Beker KO') // Districtscomp. Cat A (O23)
    expect(aug29.cells[6]).toBe('Start Fase 1') // Meiden Cat A
    expect(aug29.cells[10]).toBe('Vrij') // Districtscomp. Junioren cat. B
    const sept19 = west.days.find(d => d.label === '19 / 20 sept. 2026')!
    expect(sept19.cells[0]).toBe('WD')
    expect(sept19.cells[4]).toBe('WD NJ')
    expect(sept19.cells[6]).toBe('Week 4')
    expect(sept19.cells[12]).toBe('18/09') // Toernooi column
    expect(sept19.remark).toBeNull()
    const aug15 = west.days[0]!
    expect(aug15.cells.slice(0, 12).every(c => c === 'Vrij')).toBe(true)
    expect(aug15.remark).toContain('Schoolvak')
  })
})

describe('landelijk kalender (portrait, round numbers)', () => {
  it('parses 6 columns and speeldagen incl. the typo row', async () => {
    const landelijk = await parseFixture('landelijk')
    expect(landelijk.title.toLowerCase()).toContain('landelijke competities')
    expect(landelijk.columns).toHaveLength(6)
    const aug08 = landelijk.days[0]!
    expect(aug08.dateStart).toBe('2026-08-08') // '08/09 au.g 2026' in the source
    const aug15 = landelijk.days[1]!
    expect(aug15.dateStart).toBe('2026-08-15')
    expect(aug15.cells[0]).toBe('1') // round 1 for 2e/3e Divisie
    expect(aug15.remark).toContain('Schoolvak')
  })
})

describe('all six kalenders parse structurally', () => {
  for (const name of ['landelijk', 'landelijk-jeugd', 'noord', 'oost', 'west', 'zuid']) {
    it(`${name}: every day has a valid ISO date and cells match the column count`, async () => {
      const parsed = await parseFixture(name)
      expect(parsed.columns.length).toBeGreaterThanOrEqual(4)
      expect(parsed.days.length).toBeGreaterThanOrEqual(30)
      for (const day of parsed.days) {
        expect(day.dateStart).toMatch(/^20\d{2}-\d{2}-\d{2}$/)
        expect(day.cells).toHaveLength(parsed.columns.length)
        // season window sanity: Aug 2026 .. Jul 2027
        expect(day.dateStart >= '2026-08-01' && day.dateStart <= '2027-07-31').toBe(true)
      }
      // dates are in chronological order (matrix rows read top to bottom)
      const dates = parsed.days.map(d => d.dateStart)
      expect([...dates].sort()).toEqual(dates)
    })
  }
})
