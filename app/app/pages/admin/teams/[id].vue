<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const teamId = String(route.params.id)
const me = useMe()
const toast = useToast()

const { data, refresh, error } = await useFetch(`/api/teams/${teamId}/members`)

const isAdmin = computed(() => {
  const clubId = data.value?.team.clubId
  return !!clubId && !!me.value?.roles.adminOfClubIds.includes(clubId)
})
const isStaff = computed(() => !!me.value?.roles.staffTeamIds.includes(teamId))

onMounted(refreshMe)

const playerEmail = ref('')
const staffEmail = ref('')
const busy = ref(false)

async function run(fn: () => Promise<unknown>, okMsg: string) {
  busy.value = true
  try {
    await fn()
    toast.add({ title: okMsg })
    await refresh()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    busy.value = false
  }
}

const addPlayer = () => run(async () => {
  await $fetch(`/api/teams/${teamId}/players`, { method: 'POST', body: { email: playerEmail.value } })
  playerEmail.value = ''
}, 'Speler toegevoegd')

const addStaff = () => run(async () => {
  await $fetch(`/api/teams/${teamId}/staff`, { method: 'POST', body: { email: staffEmail.value } })
  staffEmail.value = ''
}, isAdmin.value ? 'Staflid toegevoegd' : 'Staflid aangemeld - wacht op goedkeuring beheerder')

const removePlayer = (userId: string) => run(() =>
  $fetch(`/api/teams/${teamId}/players/${userId}`, { method: 'DELETE' }), 'Speler verwijderd')

const verifyStaff = (assignmentId: string) => run(() =>
  $fetch(`/api/staff/${assignmentId}/verify`, { method: 'POST' }), 'Staflid goedgekeurd')

const removeStaff = (assignmentId: string) => run(() =>
  $fetch(`/api/staff/${assignmentId}`, { method: 'DELETE' }), 'Stafrol verwijderd')

// --- F10 trainings ---
const canManage = computed(() => isAdmin.value || isStaff.value)
const { data: slots, refresh: refreshSlots } = await useFetch(`/api/teams/${teamId}/slots`)
const { data: sessions, refresh: refreshSessions } = await useFetch(`/api/teams/${teamId}/sessions`)
const { data: seasons } = await useFetch('/api/seasons')
const { data: locations } = await useFetch('/api/locations')
const { data: periods, refresh: refreshPeriods } = await useFetch('/api/no-training-periods', { query: { teamId } })

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
const weekdayItems = WEEKDAYS.map((label, i) => ({ label, value: i + 1 }))
const seasonItems = computed(() => (seasons.value || []).map(s => ({ label: s.name, value: s.id })))
const locationItems = computed(() => (locations.value || []).map(l => ({ label: l.name, value: l.id })))
const trainerItems = computed(() => [
  { label: '(geen trainer)', value: '' },
  ...(data.value?.staff || []).filter(s => s.status === 'active').map(s => ({ label: s.name, value: s.userId }))
])

const newSlot = reactive({ seasonId: '', weekday: 1, startTime: '', endTime: '', locationId: '', trainerUserId: '' })
const addSlot = () => run(async () => {
  await $fetch(`/api/teams/${teamId}/slots`, {
    method: 'POST',
    body: { ...newSlot, trainerUserId: newSlot.trainerUserId || null }
  })
  await refreshSessions()
}, 'Trainingsreeks toegevoegd - sessies staan in het schema')

const removeSlot = (id: string) => run(async () => {
  await $fetch(`/api/slots/${id}`, { method: 'DELETE' })
  await Promise.all([refreshSlots(), refreshSessions()])
}, 'Reeks verwijderd (toekomstige sessies ook)')

const newOneOff = reactive({ date: '', startTime: '', endTime: '', locationId: '', trainerUserId: '' })
const addOneOff = () => run(async () => {
  await $fetch(`/api/teams/${teamId}/sessions`, {
    method: 'POST',
    body: { ...newOneOff, trainerUserId: newOneOff.trainerUserId || null }
  })
  await refreshSessions()
}, 'Losse training toegevoegd')

const cancelReason = ref('')
const cancelling = ref<string | null>(null)
const cancelSession = (id: string) => run(async () => {
  await $fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: { status: 'cancelled', cancelReason: cancelReason.value }
  })
  cancelling.value = null
  cancelReason.value = ''
  await refreshSessions()
}, 'Training afgelast')

const reinstateSession = (id: string) => run(async () => {
  await $fetch(`/api/sessions/${id}`, { method: 'PATCH', body: { status: 'scheduled' } })
  await refreshSessions()
}, 'Training hersteld')

// F12/F21 matches
const newMatch = reactive({ date: '', startTime: '', endTime: '', opponent: '', homeAway: 'home' as 'home' | 'away', locationText: '' })
const homeAwayItems = [
  { label: 'Thuis', value: 'home' },
  { label: 'Uit', value: 'away' }
]
const addMatch = () => run(async () => {
  await $fetch(`/api/teams/${teamId}/matches`, {
    method: 'POST',
    body: { ...newMatch, endTime: newMatch.endTime || undefined, locationText: newMatch.locationText || null }
  })
  Object.assign(newMatch, { date: '', startTime: '', endTime: '', opponent: '', homeAway: 'home', locationText: '' })
  await refreshSessions()
}, 'Wedstrijd toegevoegd')

interface PreviewRow {
  externalUid: string | null
  date: string
  startTime: string
  endTime: string
  opponent: string
  homeAway: 'home' | 'away'
  locationText: string | null
  summary: string | null
  utcFlag: boolean
  alreadyImported: boolean
}
const preview = ref<{ rows: PreviewRow[], skipped: { summary: string | null, reason: string }[] } | null>(null)
const selectedRows = ref<Set<string>>(new Set())

function rowKey(r: PreviewRow): string {
  return r.externalUid ?? `${r.date}|${r.startTime}|${r.opponent}`
}

async function onIcalFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const ical = await file.text()
  await run(async () => {
    preview.value = await $fetch(`/api/teams/${teamId}/matches/import-preview`, {
      method: 'POST',
      body: { ical }
    })
    selectedRows.value = new Set(preview.value!.rows.filter(r => !r.alreadyImported).map(rowKey))
  }, 'Voorbeeld geladen - controleer en importeer')
}

function toggleRow(r: PreviewRow) {
  const key = rowKey(r)
  if (selectedRows.value.has(key)) selectedRows.value.delete(key)
  else selectedRows.value.add(key)
  selectedRows.value = new Set(selectedRows.value)
}

const doImport = () => run(async () => {
  const rows = (preview.value?.rows || [])
    .filter(r => selectedRows.value.has(rowKey(r)))
    .map(({ externalUid, date, startTime, endTime, opponent, homeAway, locationText }) =>
      ({ externalUid, date, startTime, endTime, opponent, homeAway, locationText }))
  if (!rows.length) return
  const res = await $fetch(`/api/teams/${teamId}/matches/import`, { method: 'POST', body: { rows } })
  toast.add({ title: `${res.imported} wedstrijd(en) geimporteerd, ${res.skipped} overgeslagen` })
  preview.value = null
  await refreshSessions()
}, 'Import verwerkt')

const newPeriod = reactive({ startDate: '', endDate: '', reason: '' })
const addPeriod = () => run(async () => {
  await $fetch('/api/no-training-periods', { method: 'POST', body: { teamId, ...newPeriod } })
  Object.assign(newPeriod, { startDate: '', endDate: '', reason: '' })
  await Promise.all([refreshPeriods(), refreshSessions()])
}, 'Trainingsvrije periode ingesteld')

const removePeriod = (id: string) => run(async () => {
  await $fetch(`/api/no-training-periods/${id}`, { method: 'DELETE' })
  await refreshPeriods()
}, 'Periode verwijderd')

const { load: loadFormats, fmtDate: fmtDateBase, settings: fmtSettings } = useFormats()
onMounted(loadFormats)

function fmtDate(d: string): string {
  // Weekday prefix helps planning; the date itself follows the instance format (F26).
  if (fmtSettings.value.dateFormat === 'DD-MM-YYYY') {
    return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }
  const weekday = new Date(`${d}T00:00:00`).toLocaleDateString(
    fmtSettings.value.dateFormat === 'MM/DD/YYYY' ? 'en-US' : 'nl-NL', { weekday: 'short' })
  return `${weekday} ${fmtDateBase(d)}`
}

// --- F13 staff corrections + F15 stats ---
const { data: stats, refresh: refreshStats } = await useFetch(`/api/teams/${teamId}/attendance-stats`)
const CLASS_LABELS: Record<string, string> = {
  'timely': 'tijdig',
  'late': 'te laat',
  'no-show': 'niet gemeld'
}
const noShowFor = ref<string | null>(null)
const noShowPlayer = ref('')
const playerItems = computed(() =>
  (data.value?.players || []).map(p => ({ label: p.name, value: p.userId })))

const recordNoShow = (sessionId: string) => run(async () => {
  await $fetch(`/api/sessions/${sessionId}/no-shows`, {
    method: 'POST',
    body: { playerUserId: noShowPlayer.value }
  })
  noShowFor.value = null
  await Promise.all([refreshSessions(), refreshStats()])
}, 'No-show genoteerd')

const removeAbsence = (absenceId: string) => run(async () => {
  await $fetch(`/api/absences/${absenceId}`, { method: 'DELETE' })
  await Promise.all([refreshSessions(), refreshStats()])
}, 'Afwezigheid verwijderd')
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="error.statusMessage || 'Geen toegang tot dit team'"
    />

    <template v-else-if="data">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">
          {{ data.team.name }}
        </h1>
        <UButton
          to="/admin"
          label="Terug naar beheer"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
        />
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Spelers ({{ data.players.length }})
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="playerEmail"
              class="w-full"
              placeholder="e-mailadres van geregistreerde speler"
            />
            <UButton
              label="Toevoegen"
              :loading="busy"
              @click="addPlayer"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="p in data.players"
              :key="p.userId"
              class="flex items-center justify-between py-2"
            >
              <span>{{ p.name }} <span class="text-muted text-sm">{{ p.email }}</span></span>
              <UButton
                v-if="isAdmin"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removePlayer(p.userId)"
              />
            </li>
            <li
              v-if="!data.players.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen spelers.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Staf ({{ data.staff.length }})
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin || isStaff"
            class="flex gap-2"
          >
            <UInput
              v-model="staffEmail"
              class="w-full"
              placeholder="e-mailadres van geregistreerd staflid"
            />
            <UButton
              label="Toevoegen"
              :loading="busy"
              @click="addStaff"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="s in data.staff"
              :key="s.assignmentId"
              class="flex items-center justify-between py-2"
            >
              <span>
                {{ s.name }} <span class="text-muted text-sm">{{ s.email }}</span>
                <UBadge
                  v-if="s.status === 'pending'"
                  color="warning"
                  variant="subtle"
                  label="wacht op goedkeuring"
                />
              </span>
              <span
                v-if="isAdmin"
                class="flex gap-2"
              >
                <UButton
                  v-if="s.status === 'pending'"
                  label="Goedkeuren"
                  size="xs"
                  color="success"
                  variant="outline"
                  @click="verifyStaff(s.assignmentId)"
                />
                <UButton
                  :label="s.status === 'pending' ? 'Afwijzen' : 'Verwijderen'"
                  size="xs"
                  color="error"
                  variant="outline"
                  @click="removeStaff(s.assignmentId)"
                />
              </span>
            </li>
            <li
              v-if="!data.staff.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen staf.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Wekelijkse trainingsreeksen
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="canManage"
            class="grid grid-cols-2 md:grid-cols-3 gap-2 items-end"
          >
            <UFormField label="Seizoen">
              <USelect
                v-model="newSlot.seasonId"
                :items="seasonItems"
                class="w-full"
                placeholder="kies seizoen"
              />
            </UFormField>
            <UFormField label="Dag">
              <USelect
                v-model="newSlot.weekday"
                :items="weekdayItems"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Locatie">
              <USelect
                v-model="newSlot.locationId"
                :items="locationItems"
                class="w-full"
                placeholder="kies locatie"
              />
            </UFormField>
            <UFormField label="Van">
              <UInput
                v-model="newSlot.startTime"
                type="time"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Tot">
              <UInput
                v-model="newSlot.endTime"
                type="time"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Trainer">
              <USelect
                v-model="newSlot.trainerUserId"
                :items="trainerItems"
                class="w-full"
              />
            </UFormField>
            <UButton
              label="Reeks toevoegen"
              :loading="busy"
              class="col-span-2 md:col-span-3 justify-center"
              @click="addSlot"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="s in slots || []"
              :key="s.id"
              class="flex items-center justify-between py-2"
            >
              <span>
                {{ WEEKDAYS[s.weekday - 1] }} {{ s.startTime }}-{{ s.endTime }}
                <span class="text-muted text-sm">{{ locationItems.find(l => l.value === s.locationId)?.label }}</span>
              </span>
              <UButton
                v-if="canManage"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removeSlot(s.id)"
              />
            </li>
            <li
              v-if="!slots?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen wekelijkse reeks.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Wedstrijden
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="canManage"
            class="space-y-3"
          >
            <UFormField label="Sportlink-import (.ics): kies het bestand, controleer het voorbeeld, en importeer">
              <input
                type="file"
                accept=".ics,text/calendar"
                class="text-sm"
                @change="onIcalFile"
              >
            </UFormField>
            <div
              v-if="preview"
              class="space-y-2"
            >
              <ul class="divide-y divide-default">
                <li
                  v-for="r in preview.rows"
                  :key="rowKey(r)"
                  class="flex items-center gap-3 py-2"
                >
                  <UCheckbox
                    :model-value="selectedRows.has(rowKey(r))"
                    :disabled="r.alreadyImported"
                    @update:model-value="toggleRow(r)"
                  />
                  <span :class="r.alreadyImported ? 'text-muted' : ''">
                    {{ fmtDate(r.date) }} {{ r.startTime }}-{{ r.endTime }}
                    <strong>{{ r.opponent }}</strong>
                    ({{ r.homeAway === 'home' ? 'thuis' : 'uit' }})
                    <span class="text-muted text-sm">{{ r.locationText }}</span>
                    <UBadge
                      v-if="r.alreadyImported"
                      color="neutral"
                      variant="subtle"
                      label="al geimporteerd"
                    />
                    <UBadge
                      v-if="r.utcFlag"
                      color="warning"
                      variant="subtle"
                      label="UTC-tijd, controleer"
                    />
                  </span>
                </li>
              </ul>
              <p
                v-for="(s, i) in preview.skipped"
                :key="i"
                class="text-sm text-muted"
              >
                Overgeslagen: {{ s.summary || '(zonder titel)' }} - {{ s.reason }}
              </p>
              <UButton
                :label="`Importeer ${selectedRows.size} wedstrijd(en)`"
                :disabled="!selectedRows.size"
                :loading="busy"
                @click="doImport"
              />
            </div>
            <USeparator label="of handmatig" />
            <div class="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
              <UFormField label="Datum">
                <UInput
                  v-model="newMatch.date"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Aanvang">
                <UInput
                  v-model="newMatch.startTime"
                  type="time"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Tegenstander">
                <UInput
                  v-model="newMatch.opponent"
                  class="w-full"
                  placeholder="RKDES MO17-3"
                />
              </UFormField>
              <UFormField label="Thuis/uit">
                <USelect
                  v-model="newMatch.homeAway"
                  :items="homeAwayItems"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Locatie">
                <UInput
                  v-model="newMatch.locationText"
                  class="w-full"
                  placeholder="Sportpark ..."
                />
              </UFormField>
              <UButton
                label="Toevoegen"
                :loading="busy"
                @click="addMatch"
              />
            </div>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            Wedstrijden staan in het programma hieronder.
          </p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Programma ({{ (sessions || []).length }})
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="canManage"
            class="grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
          >
            <UFormField label="Datum (losse training)">
              <UInput
                v-model="newOneOff.date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Van">
              <UInput
                v-model="newOneOff.startTime"
                type="time"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Tot">
              <UInput
                v-model="newOneOff.endTime"
                type="time"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Locatie">
              <USelect
                v-model="newOneOff.locationId"
                :items="locationItems"
                class="w-full"
                placeholder="kies"
              />
            </UFormField>
            <UButton
              label="Toevoegen"
              :loading="busy"
              @click="addOneOff"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="s in sessions || []"
              :key="s.id"
              class="py-2 space-y-1"
            >
              <div class="flex items-center justify-between gap-2">
                <span :class="s.status === 'cancelled' ? 'line-through text-muted' : ''">
                  <UBadge
                    v-if="s.type === 'match'"
                    color="primary"
                    variant="subtle"
                    :label="s.homeAway === 'home' ? 'thuis' : 'uit'"
                  />
                  {{ fmtDate(s.date) }} {{ s.startTime }}-{{ s.endTime }}
                  <strong v-if="s.type === 'match'">{{ s.opponent }}</strong>
                  <span class="text-muted text-sm">{{ s.locationName }}<template v-if="s.trainerName"> - {{ s.trainerName }}</template></span>
                </span>
                <span class="flex items-center gap-2">
                  <UBadge
                    v-if="s.status === 'cancelled'"
                    color="error"
                    variant="subtle"
                    :label="`afgelast: ${s.cancelReason}`"
                  />
                  <template v-if="canManage">
                    <UButton
                      v-if="s.status === 'scheduled'"
                      label="Afgelasten"
                      size="xs"
                      color="error"
                      variant="outline"
                      @click="cancelling = cancelling === s.id ? null : s.id"
                    />
                    <UButton
                      v-else
                      label="Herstellen"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      @click="reinstateSession(s.id)"
                    />
                  </template>
                </span>
              </div>
              <div
                v-if="cancelling === s.id"
                class="flex gap-2"
              >
                <UInput
                  v-model="cancelReason"
                  class="w-full"
                  placeholder="Reden van afgelasting"
                />
                <UButton
                  label="Bevestig afgelasting"
                  size="xs"
                  color="error"
                  :loading="busy"
                  @click="cancelSession(s.id)"
                />
              </div>
              <p
                v-if="s.absences.length"
                class="text-sm text-muted"
              >
                Afgemeld:
                <template
                  v-for="(a, i) in s.absences"
                  :key="a.id"
                >
                  <template v-if="i > 0">
                    ,
                  </template>{{ a.playerName }} ({{ CLASS_LABELS[a.classification] }}<template v-if="a.reason">
                    - {{ a.reason }}
                  </template>)<UButton
                    v-if="canManage"
                    icon="i-lucide-x"
                    size="xs"
                    variant="link"
                    color="error"
                    aria-label="Afwezigheid verwijderen"
                    @click="removeAbsence(a.id)"
                  />
                </template>
              </p>
              <div
                v-if="canManage && s.type === 'training' && s.status === 'scheduled'"
                class="space-y-1"
              >
                <UButton
                  label="No-show noteren"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="noShowFor = noShowFor === s.id ? null : s.id; noShowPlayer = ''"
                />
                <div
                  v-if="noShowFor === s.id"
                  class="flex gap-2"
                >
                  <USelect
                    v-model="noShowPlayer"
                    :items="playerItems"
                    placeholder="speler"
                    class="min-w-40"
                  />
                  <UButton
                    label="Noteer no-show"
                    size="xs"
                    :disabled="!noShowPlayer"
                    :loading="busy"
                    @click="recordNoShow(s.id)"
                  />
                </div>
              </div>
            </li>
            <li
              v-if="!sessions?.length"
              class="py-2 text-muted text-sm"
            >
              Geen komende trainingen.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Aanwezigheid (trainingen)
          </h2>
        </template>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Zichtbaar voor iedereen bij het team: spelers, staf en ouders. Gebaseerd op {{ stats?.totalTrainings ?? 0 }} gespeelde training(en).
          </p>
          <ul class="divide-y divide-default">
            <li
              v-for="p in stats?.players || []"
              :key="p.userId"
              class="flex items-center justify-between py-2"
            >
              <span>{{ p.name }}</span>
              <span class="flex items-center gap-3 text-sm">
                <span class="text-muted">
                  {{ p.counts.timely }} tijdig / {{ p.counts.late }} te laat / {{ p.counts.noShow }} niet gemeld
                </span>
                <UBadge
                  :color="p.percentage === null ? 'neutral' : p.percentage >= 80 ? 'success' : p.percentage >= 60 ? 'warning' : 'error'"
                  variant="subtle"
                  :label="p.percentage === null ? '-' : `${p.percentage}%`"
                />
              </span>
            </li>
            <li
              v-if="!stats?.players.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen spelers of trainingen.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Trainingsvrije periodes
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Clubbrede sluitingsperiodes gelden altijd en kunnen hier niet worden opgeheven.
          </p>
          <div
            v-if="canManage"
            class="flex gap-2"
          >
            <UInput
              v-model="newPeriod.startDate"
              type="date"
            />
            <UInput
              v-model="newPeriod.endDate"
              type="date"
            />
            <UInput
              v-model="newPeriod.reason"
              class="w-full"
              placeholder="Reden, bijv. toernooiweekend"
            />
            <UButton
              label="Instellen"
              :loading="busy"
              @click="addPeriod"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="p in periods || []"
              :key="p.id"
              class="flex items-center justify-between py-2"
            >
              <span>
                {{ fmtDate(p.startDate) }} t/m {{ fmtDate(p.endDate) }}
                <span class="text-muted text-sm">{{ p.reason }}</span>
                <UBadge
                  v-if="!p.teamId"
                  color="neutral"
                  variant="subtle"
                  label="hele club"
                />
              </span>
              <UButton
                v-if="canManage && p.teamId"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removePeriod(p.id)"
              />
            </li>
            <li
              v-if="!periods?.length"
              class="py-2 text-muted text-sm"
            >
              Geen trainingsvrije periodes.
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </div>
</template>
