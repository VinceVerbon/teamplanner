// F26: instance-wide date/time formatting, driven by the instance settings.
interface InstanceFormatSettings {
  dateFormat: 'DD-MM-YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  timeFormat: '24h' | '12h'
  weekNumbering: 'iso' | 'us'
}

const DEFAULTS: InstanceFormatSettings = { dateFormat: 'DD-MM-YYYY', timeFormat: '24h', weekNumbering: 'iso' }

export function useFormats() {
  const settings = useState<InstanceFormatSettings>('instance-formats', () => DEFAULTS)

  async function load() {
    try {
      settings.value = await $fetch<InstanceFormatSettings>('/api/instance/settings')
    } catch {
      settings.value = DEFAULTS
    }
  }

  /** 'YYYY-MM-DD' string -> display date per instance settings. */
  function fmtDate(d: string): string {
    const date = new Date(`${d}T00:00:00`)
    switch (settings.value.dateFormat) {
      case 'MM/DD/YYYY': return date.toLocaleDateString('en-US')
      case 'YYYY-MM-DD': return d
      default: return date.toLocaleDateString('nl-NL')
    }
  }

  /** 'HH:MM' string -> display time per instance settings. */
  function fmtTime(t: string): string {
    if (settings.value.timeFormat === '24h') return t
    const [hStr, m] = t.split(':')
    const h = Number(hStr)
    const suffix = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${m} ${suffix}`
  }

  return { settings, load, fmtDate, fmtTime }
}
