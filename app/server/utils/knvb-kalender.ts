// F28: pure parser for KNVB speeldagenkalender PDFs. Input is positioned text items
// (from the pdf adapter); everything here is deterministic and testable offline.
//
// Layout knowledge (verified against the 2026/'27 PDFs):
// - One table per page: rows are speeldag weekends ("15 / 16 aug. 2026"), columns are
//   the categories/classes (multi-line headers), the rightmost column holds remarks
//   ("Algemeen" in the district PDFs, "Opmerkingen" in the landelijke ones).
// - Text items are centered per column, so clustering the x-centers of the cell items
//   recovers the column bands; header items are assigned to the nearest band.

export interface PdfTextItem {
  str: string
  x: number
  y: number
  w: number
}

export interface ParsedKalenderDay {
  label: string
  dateStart: string
  dateEnd: string | null
  /** One entry per column (same order as `columns`); null = empty cell. */
  cells: (string | null)[]
  remark: string | null
}

export interface ParsedKalender {
  title: string
  columns: string[]
  days: ParsedKalenderDay[]
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12
}
const MONTH_RE = 'jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec'

const LABEL_MAX_X = 110 // date labels sit in the leftmost band
const ROW_Y_TOLERANCE = 3
const BAND_GAP = 30 // x-centers further apart than this start a new column band
const BAND_SEED_MAX_WIDTH = 100 // only normal-width cells seed bands (long notes span)

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse a speeldag label like "15 / 16 aug. 2026", "31 okt. / 1 nov. 2026",
 * "zat. 27 mrt. 2027", "1 - 3 juni 2027" or "08/09 au.g 2026" (source typo).
 */
export function parseDayLabel(raw: string): { dateStart: string, dateEnd: string | null } | null {
  const label = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  const yearMatch = label.match(/\b(20\d{2})\b/)
  if (!yearMatch) return null
  const year = Number(yearMatch[1])
  const body = label.slice(0, yearMatch.index)
  const re = new RegExp(`\\b(\\d{1,2})\\s*(${MONTH_RE})?`, 'g')
  const tokens: { day: number, month: number | null }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    tokens.push({ day: Number(m[1]), month: m[2] ? MONTHS[m[2]]! : null })
  }
  if (tokens.length === 0 || !tokens.some(t => t.month !== null)) return null
  // A missing month reads forward ("15 / 16 aug." = both August), else backward.
  tokens.forEach((t, i) => {
    if (t.month === null) {
      const next = tokens.slice(i + 1).find(o => o.month !== null)
      const prev = [...tokens.slice(0, i)].reverse().find(o => o.month !== null)
      t.month = next?.month ?? prev?.month ?? null
    }
  })
  const valid = tokens.filter(t => t.month !== null && t.day >= 1 && t.day <= 31)
  if (valid.length === 0) return null
  const first = valid[0]!
  const last = valid[valid.length - 1]!
  const dateStart = iso(year, first.month!, first.day)
  const dateEnd = valid.length > 1 && (last.day !== first.day || last.month !== first.month)
    ? iso(year, last.month!, last.day)
    : null
  return { dateStart, dateEnd }
}

interface Row { y: number, items: PdfTextItem[] }

function groupRows(items: PdfTextItem[]): Row[] {
  const rows: Row[] = []
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str.trim()) continue
    const row = rows.find(r => Math.abs(r.y - it.y) <= ROW_Y_TOLERANCE)
    if (row) row.items.push(it)
    else rows.push({ y: it.y, items: [it] })
  }
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x))
  return rows
}

const center = (it: PdfTextItem) => it.x + it.w / 2

/** Parse one PDF page's positioned text items into the kalender grid. */
export function parseKalenderItems(items: PdfTextItem[]): ParsedKalender {
  const rows = groupRows(items)
  if (rows.length === 0) throw new Error('Kalender PDF bevat geen tekst')
  const title = rows[0]!.items.map(i => i.str.trim()).join(' ')

  const isDateRow = (row: Row) => {
    const labelText = row.items.filter(i => i.x < LABEL_MAX_X).map(i => i.str).join(' ')
    return labelText.length > 0 && parseDayLabel(labelText) !== null
  }
  const dateRows = rows.filter(isDateRow)
  if (dateRows.length === 0) throw new Error('Kalender PDF bevat geen herkenbare speeldagen')

  // Column bands from the x-centers of normal-width cells on date rows.
  const centers = dateRows
    .flatMap(r => r.items.filter(i => i.x >= LABEL_MAX_X && i.w <= BAND_SEED_MAX_WIDTH))
    .map(center)
    .sort((a, b) => a - b)
  const bands: { min: number, max: number }[] = []
  for (const c of centers) {
    const band = bands[bands.length - 1]
    if (band && c - band.max <= BAND_GAP) band.max = c
    else bands.push({ min: c, max: c })
  }
  if (bands.length < 2) throw new Error('Kalender PDF heeft geen herkenbare kolommen')
  const bandCenter = (b: { min: number, max: number }) => (b.min + b.max) / 2
  const nearestBand = (it: PdfTextItem) => {
    const c = center(it)
    let best = 0
    for (let i = 1; i < bands.length; i++) {
      if (Math.abs(c - bandCenter(bands[i]!)) < Math.abs(c - bandCenter(bands[best]!))) best = i
    }
    return best
  }

  // Header text per band: everything between the title row and the first date row.
  const firstDateY = dateRows[0]!.y
  const headerRows = rows.slice(1).filter(r => r.y > firstDateY && !isDateRow(r))
  const headers: string[] = bands.map(() => '')
  for (const row of headerRows) {
    for (const it of row.items) {
      if (it.x < LABEL_MAX_X) continue
      const b = nearestBand(it)
      headers[b] = headers[b] ? `${headers[b]} ${it.str.trim()}` : it.str.trim()
    }
  }

  // The remark band: header says Algemeen/Opmerkingen, otherwise the rightmost band.
  let remarkBand = bands.length - 1
  const flagged = headers.findIndex(h => /algemeen|opmerkingen/i.test(h))
  if (flagged >= 0) remarkBand = flagged
  const columnBands = bands.map((_, i) => i).filter(i => i !== remarkBand)
  const columns = columnBands.map(i => headers[i]!.trim())

  const days: ParsedKalenderDay[] = []
  for (const row of dateRows) {
    const label = row.items.filter(i => i.x < LABEL_MAX_X).map(i => i.str.trim()).join(' ')
    const dates = parseDayLabel(label)!
    const perBand: string[] = bands.map(() => '')
    for (const it of row.items) {
      if (it.x < LABEL_MAX_X) continue
      const b = nearestBand(it)
      perBand[b] = perBand[b] ? `${perBand[b]} ${it.str.trim()}` : it.str.trim()
    }
    days.push({
      label,
      dateStart: dates.dateStart,
      dateEnd: dates.dateEnd,
      cells: columnBands.map(i => perBand[i]!.trim() || null),
      remark: perBand[remarkBand]!.trim() || null
    })
  }

  return { title, columns, days }
}
