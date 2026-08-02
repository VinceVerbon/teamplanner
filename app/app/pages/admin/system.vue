<script setup lang="ts">
// F26: instance-level (system) management - separate from club management. The instance
// is not the club: one instance can hold multiple clubs later.
import { changesToMarkdown, describeChange, type KalenderChange } from '../../../shared/utils/speeldagen-diff'

definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { isInstanceAdmin } = useAdminCtx()

// F28: KNVB speeldagenkalenders - central fetch/parse + activation lifecycle.
interface KalenderRow {
  id: string
  season: string
  region: string
  title: string
  status: 'pending' | 'active'
  fetchedAt: string
  columns: number
  days: number
}
const { data: kalenders, refresh: refreshKalenders } = await useFetch<KalenderRow[]>('/api/instance/speeldagenkalenders')
const kalenderBusy = ref(false)
const fetchSummary = ref<{ region: string, status: string, days?: number, changes?: KalenderChange[], error?: string }[]>([])
const openDiff = ref<{ kalender: KalenderRow, changes: KalenderChange[] } | null>(null)
const confirmForceReload = ref(false)

const REGION_LABELS: Record<string, string> = {
  'landelijk': 'Landelijk', 'landelijk-jeugd': 'Landelijk jeugd',
  'noord': 'Noord', 'oost': 'Oost', 'west': 'West', 'zuid': 'Zuid'
}
const FETCH_STATUS_LABELS: Record<string, string> = {
  'pending-new': 'nieuw opgehaald (activeren om te gebruiken)',
  'no-changes': 'geen wijzigingen',
  'changes-pending': 'wijzigingen gevonden - beoordeel en verwerk',
  'error': 'fout'
}

function hasActiveCounterpart(k: KalenderRow): boolean {
  return !!kalenders.value?.some(o => o.region === k.region && o.season === k.season && o.status === 'active')
}

async function kalenderAction(fn: () => Promise<unknown>, okMsg?: string) {
  kalenderBusy.value = true
  try {
    await fn()
    if (okMsg) toast.add({ title: okMsg })
    await refreshKalenders()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    kalenderBusy.value = false
  }
}

const fetchKalenders = () => kalenderAction(async () => {
  fetchSummary.value = await $fetch('/api/instance/speeldagenkalenders/fetch', { method: 'POST' })
}, 'Kalenders opgehaald')

const activateKalender = (k: KalenderRow) => kalenderAction(async () => {
  await $fetch(`/api/instance/speeldagenkalenders/${k.id}/activate`, { method: 'POST' })
  openDiff.value = null
  fetchSummary.value = []
}, hasActiveCounterpart(k) ? 'Wijzigingen verwerkt en gelogd' : 'Kalender geactiveerd')

const cancelPending = (k: KalenderRow) => kalenderAction(async () => {
  await $fetch(`/api/instance/speeldagenkalenders/${k.id}`, { method: 'DELETE' })
  openDiff.value = null
}, 'Wijzigingen geannuleerd (voor nu)')

async function showDiff(k: KalenderRow) {
  try {
    const changes = await $fetch<KalenderChange[]>(`/api/instance/speeldagenkalenders/${k.id}/diff`)
    openDiff.value = { kalender: k, changes }
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Kon wijzigingen niet laden', color: 'error' })
  }
}

function exportDiffMd() {
  if (!openDiff.value) return
  const { kalender, changes } = openDiff.value
  const md = changesToMarkdown(
    { season: kalender.season, region: REGION_LABELS[kalender.region] || kalender.region, generatedAt: new Date().toISOString() },
    changes
  )
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `speeldagenkalender-wijzigingen-${kalender.region}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

const forceReload = () => kalenderAction(async () => {
  confirmForceReload.value = false
  fetchSummary.value = await $fetch('/api/instance/speeldagenkalenders/force-reload', { method: 'POST' })
  openDiff.value = null
}, 'Speeldagenkalenders volledig opnieuw geladen')

function fmtStamp(ts: string): string {
  return new Date(ts).toLocaleString('nl-NL')
}

const { data: settings, refresh: refreshSettings } = await useFetch('/api/instance/settings')
const { data: admins, refresh: refreshAdmins, error: adminsError } = await useFetch('/api/instance/admins')

const dateFormats = [
  { label: '31-12-2026 (DD-MM-YYYY)', value: 'DD-MM-YYYY' },
  { label: '12/31/2026 (MM/DD/YYYY)', value: 'MM/DD/YYYY' },
  { label: '2026-12-31 (YYYY-MM-DD)', value: 'YYYY-MM-DD' }
]
const timeFormats = [
  { label: '19:30 (24-uurs)', value: '24h' },
  { label: '7:30 PM (12-uurs)', value: '12h' }
]
const weekNumberings = [
  { label: 'ISO 8601 (week begint op maandag)', value: 'iso' },
  { label: 'VS (week begint op zondag)', value: 'us' }
]

const form = reactive({ dateFormat: 'DD-MM-YYYY', timeFormat: '24h', weekNumbering: 'iso' })
watchEffect(() => {
  if (settings.value) {
    form.dateFormat = settings.value.dateFormat
    form.timeFormat = settings.value.timeFormat
    form.weekNumbering = settings.value.weekNumbering
  }
})

const savingSettings = ref(false)
async function saveSettings() {
  savingSettings.value = true
  try {
    await $fetch('/api/instance/settings', { method: 'PATCH', body: { ...form } })
    toast.add({ title: 'Systeeminstellingen opgeslagen' })
    await refreshSettings()
    await useFormats().load()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Opslaan is niet gelukt', color: 'error' })
  } finally {
    savingSettings.value = false
  }
}

const newAdminEmail = ref('')
const busyAdmins = ref(false)
async function grantAdmin() {
  busyAdmins.value = true
  try {
    await $fetch('/api/instance/admins', { method: 'POST', body: { email: newAdminEmail.value } })
    toast.add({ title: 'Systeembeheerder toegevoegd' })
    newAdminEmail.value = ''
    await refreshAdmins()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Toevoegen is niet gelukt', color: 'error' })
  } finally {
    busyAdmins.value = false
  }
}

async function revokeAdmin(id: string) {
  busyAdmins.value = true
  try {
    await $fetch(`/api/instance/admins/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Systeembeheerder verwijderd' })
    await refreshAdmins()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Verwijderen is niet gelukt', color: 'error' })
  } finally {
    busyAdmins.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="!isInstanceAdmin"
      color="warning"
      variant="subtle"
      title="Alleen systeembeheerders hebben toegang tot systeeminstellingen."
    />
    <template v-else>
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Systeeminstellingen
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Instellingen voor de hele installatie (alle clubs). Clubspecifieke
            instellingen staan onder Club, Thema en Gebruikers.
          </p>
          <UFormField label="Datumnotatie">
            <USelect
              v-model="form.dateFormat"
              :items="dateFormats"
              class="w-72"
            />
          </UFormField>
          <UFormField label="Tijdnotatie">
            <USelect
              v-model="form.timeFormat"
              :items="timeFormats"
              class="w-72"
            />
          </UFormField>
          <UFormField label="Weeknummering">
            <USelect
              v-model="form.weekNumbering"
              :items="weekNumberings"
              class="w-72"
            />
          </UFormField>
          <UButton
            label="Opslaan"
            :loading="savingSettings"
            @click="saveSettings"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            KNVB speeldagenkalenders
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Haalt de officiele speeldagenkalenders (veldvoetbal, seizoen 2026/'27) op van
            knvb.nl en parseert ze centraal. Na activering worden bij een nieuwe ophaalactie
            alleen wijzigingen verwerkt; verwerkte wijzigingen zijn voor alle clubs en staf
            zichtbaar in het wijzigingenlogboek (Beheer &gt; Schema).
          </p>
          <div class="flex gap-2">
            <UButton
              label="Kalenders ophalen"
              icon="i-lucide-download"
              :loading="kalenderBusy"
              @click="fetchKalenders"
            />
            <UButton
              label="Force reload"
              icon="i-lucide-refresh-ccw"
              color="error"
              variant="outline"
              :disabled="kalenderBusy"
              @click="confirmForceReload = true"
            />
          </div>

          <UAlert
            v-for="r in fetchSummary"
            :key="r.region"
            :color="r.status === 'error' ? 'error' : (r.status === 'changes-pending' ? 'warning' : 'info')"
            variant="subtle"
            :title="`${REGION_LABELS[r.region] || r.region}: ${FETCH_STATUS_LABELS[r.status] || r.status}${r.error ? ` - ${r.error}` : ''}`"
          />

          <ul class="divide-y divide-default">
            <li
              v-for="k in kalenders || []"
              :key="k.id"
              class="py-3 flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <div class="flex-1 min-w-0">
                <span class="font-medium">{{ REGION_LABELS[k.region] || k.region }}</span>
                <UBadge
                  :color="k.status === 'active' ? 'success' : 'warning'"
                  variant="subtle"
                  :label="k.status === 'active' ? 'actief' : 'in afwachting'"
                  class="ml-2"
                />
                <span class="text-muted text-sm ml-2">{{ k.season }} - {{ k.days }} speeldagen, {{ k.columns }} kolommen - opgehaald {{ fmtStamp(k.fetchedAt) }}</span>
              </div>
              <div
                v-if="k.status === 'pending'"
                class="flex gap-2"
              >
                <UButton
                  v-if="hasActiveCounterpart(k)"
                  label="Wijzigingen bekijken"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  @click="showDiff(k)"
                />
                <UButton
                  :label="hasActiveCounterpart(k) ? 'Verwerk wijzigingen' : 'Activeren'"
                  size="xs"
                  :disabled="kalenderBusy"
                  @click="activateKalender(k)"
                />
                <UButton
                  label="Annuleren"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="kalenderBusy"
                  @click="cancelPending(k)"
                />
              </div>
            </li>
            <li
              v-if="!kalenders?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen kalenders opgehaald.
            </li>
          </ul>

          <UCard
            v-if="openDiff"
            variant="subtle"
          >
            <template #header>
              <div class="flex items-center justify-between">
                <h3 class="font-medium">
                  Wijzigingen {{ REGION_LABELS[openDiff.kalender.region] || openDiff.kalender.region }} ({{ openDiff.changes.length }})
                </h3>
                <div class="flex gap-2">
                  <UButton
                    label="Export .md"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-file-down"
                    @click="exportDiffMd"
                  />
                  <UButton
                    label="Verwerk wijzigingen"
                    size="xs"
                    :disabled="kalenderBusy"
                    @click="activateKalender(openDiff.kalender)"
                  />
                  <UButton
                    label="Annuleren"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="kalenderBusy"
                    @click="cancelPending(openDiff.kalender)"
                  />
                </div>
              </div>
            </template>
            <ul class="text-sm space-y-1 max-h-80 overflow-y-auto">
              <li
                v-for="(c, i) in openDiff.changes"
                :key="i"
              >
                {{ describeChange(c) }}
              </li>
            </ul>
          </UCard>
        </div>
      </UCard>

      <UModal
        v-model:open="confirmForceReload"
        title="Force reload - weet je het zeker?"
      >
        <template #body>
          <p class="text-sm">
            Dit verwijdert het volledige speeldagenkalender-model (actief en in afwachting)
            en laadt alles opnieuw van knvb.nl - zonder wijzigingsbeoordeling.
            Teamkoppelingen worden waar mogelijk op kolomnaam hersteld, maar reeds gemaakte
            planningen kunnen hierdoor ongemerkt verschuiven. Gebruik dit alleen als het
            normale ophalen-en-verwerken niet volstaat.
          </p>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              label="Annuleren"
              color="neutral"
              variant="outline"
              @click="confirmForceReload = false"
            />
            <UButton
              label="Ja, alles opnieuw laden"
              color="error"
              :loading="kalenderBusy"
              @click="forceReload"
            />
          </div>
        </template>
      </UModal>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Systeembeheerders
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Systeembeheerders beheren de installatie: instellingen, clubs en accounts.
            Clubbeheer staat hier los van en regel je per club.
          </p>
          <div class="flex gap-2">
            <UInput
              v-model="newAdminEmail"
              type="email"
              class="w-full"
              placeholder="e-mailadres van een bestaand account"
            />
            <UButton
              label="Toevoegen"
              :loading="busyAdmins"
              @click="grantAdmin"
            />
          </div>
          <UAlert
            v-if="adminsError"
            color="error"
            variant="subtle"
            title="Kon systeembeheerders niet laden."
          />
          <ul class="divide-y divide-default">
            <li
              v-for="a in admins || []"
              :key="a.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ a.name }} <span class="text-muted text-sm">{{ a.email }}</span></span>
              <UButton
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                :disabled="busyAdmins || (admins || []).length <= 1"
                @click="revokeAdmin(a.id)"
              />
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </div>
</template>
