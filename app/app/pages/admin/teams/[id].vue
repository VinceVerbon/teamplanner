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

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <UContainer class="max-w-3xl py-16 space-y-6">
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
            Komende trainingen ({{ (sessions || []).length }})
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
                  {{ fmtDate(s.date) }} {{ s.startTime }}-{{ s.endTime }}
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
  </UContainer>
</template>
