// F28: change model for speeldagenkalender updates. The server computes diffs between
// the active kalender and a newly fetched one; the client renders them and exports .md.

export type KalenderChangeKind
  = 'kalender-activated'
    | 'kalender-force-reloaded'
    | 'day-added'
    | 'day-removed'
    | 'day-dates-changed'
    | 'day-remark-changed'
    | 'cell-changed'
    | 'column-added'
    | 'column-removed'

export interface KalenderChange {
  kind: KalenderChangeKind
  dayLabel?: string
  columnTitle?: string
  before?: string | null
  after?: string | null
}

const val = (v: string | null | undefined) => (v == null || v === '' ? 'leeg' : `'${v}'`)

export function describeChange(c: KalenderChange): string {
  switch (c.kind) {
    case 'kalender-activated': return 'Kalender geactiveerd'
    case 'kalender-force-reloaded': return 'Kalender volledig opnieuw geladen (force reload)'
    case 'day-added': return `Speeldag toegevoegd: ${c.dayLabel}`
    case 'day-removed': return `Speeldag verwijderd: ${c.dayLabel}`
    case 'day-dates-changed': return `Speeldag '${c.dayLabel}': datum gewijzigd van ${val(c.before)} naar ${val(c.after)}`
    case 'day-remark-changed': return `Speeldag '${c.dayLabel}': opmerking gewijzigd van ${val(c.before)} naar ${val(c.after)}`
    case 'cell-changed': return `Speeldag '${c.dayLabel}', kolom '${c.columnTitle}': ${val(c.before)} -> ${val(c.after)}`
    case 'column-added': return `Kolom toegevoegd: '${c.columnTitle}'`
    case 'column-removed': return `Kolom verwijderd: '${c.columnTitle}'`
  }
}

export function changesToMarkdown(
  header: { season: string, region: string, generatedAt: string },
  changes: KalenderChange[]
): string {
  const lines = [
    `# Speeldagenkalender wijzigingen - ${header.region} ${header.season}`,
    '',
    `Gegenereerd: ${header.generatedAt}`,
    '',
    `Aantal wijzigingen: ${changes.length}`,
    ''
  ]
  for (const c of changes) lines.push(`- ${describeChange(c)}`)
  lines.push('')
  return lines.join('\n')
}
