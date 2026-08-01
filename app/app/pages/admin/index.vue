<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const me = useMe()
const toast = useToast()

const { data: clubData, refresh: refreshClub } = await useFetch('/api/clubs/current')
const { data: teamsData, refresh: refreshTeams } = await useFetch('/api/teams', { query: { archived: '1' } })

const isAdmin = computed(() => {
  const clubId = clubData.value?.club?.id
  return !!clubId && !!me.value?.roles.adminOfClubIds.includes(clubId)
})

onMounted(refreshMe)

// club bootstrap
const newClub = reactive({ slug: '', name: '' })
const creating = ref(false)
async function createClub() {
  creating.value = true
  try {
    await $fetch('/api/clubs', { method: 'POST', body: { ...newClub } })
    toast.add({ title: 'Club aangemaakt' })
    await Promise.all([refreshClub(), refreshMe()])
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Aanmaken is niet gelukt', color: 'error' })
  } finally {
    creating.value = false
  }
}

// club settings
const clubName = ref('')
watchEffect(() => {
  if (clubData.value?.club) clubName.value = clubData.value.club.name
})
const savingClub = ref(false)
async function saveClub() {
  if (!clubData.value?.club) return
  savingClub.value = true
  try {
    await $fetch(`/api/clubs/${clubData.value.club.id}`, { method: 'PATCH', body: { name: clubName.value } })
    toast.add({ title: 'Opgeslagen' })
    await refreshClub()
  } catch {
    toast.add({ title: 'Opslaan is niet gelukt', color: 'error' })
  } finally {
    savingClub.value = false
  }
}

// teams
const newTeamName = ref('')
const creatingTeam = ref(false)
async function createTeam() {
  creatingTeam.value = true
  try {
    await $fetch('/api/teams', { method: 'POST', body: { name: newTeamName.value } })
    newTeamName.value = ''
    await refreshTeams()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Aanmaken is niet gelukt', color: 'error' })
  } finally {
    creatingTeam.value = false
  }
}

async function setArchived(teamId: string, archived: boolean) {
  await $fetch(`/api/teams/${teamId}`, { method: 'PATCH', body: { archived } })
  await refreshTeams()
}

// F10: locations, seasons, club-level closures
const { data: locations, refresh: refreshLocations } = await useFetch('/api/locations')
const { data: seasons, refresh: refreshSeasons } = await useFetch('/api/seasons')
const { data: periods, refresh: refreshPeriods } = await useFetch('/api/no-training-periods')
const clubPeriods = computed(() => (periods.value || []).filter(p => !p.teamId))

const newLocation = reactive({ name: '', address: '' })
const newSeason = reactive({ name: '', startDate: '', endDate: '' })
const newClosure = reactive({ startDate: '', endDate: '', reason: '' })
const busyF10 = ref(false)

async function act(fn: () => Promise<unknown>, okMsg: string, refreshFn: () => Promise<void>) {
  busyF10.value = true
  try {
    await fn()
    toast.add({ title: okMsg })
    await refreshFn()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    busyF10.value = false
  }
}

const addLocation = () => act(async () => {
  await $fetch('/api/locations', { method: 'POST', body: { ...newLocation } })
  Object.assign(newLocation, { name: '', address: '' })
}, 'Locatie toegevoegd', refreshLocations)

const removeLocation = (id: string) => act(() =>
  $fetch(`/api/locations/${id}`, { method: 'DELETE' }), 'Locatie verwijderd', refreshLocations)

const addSeason = () => act(async () => {
  await $fetch('/api/seasons', { method: 'POST', body: { ...newSeason } })
  Object.assign(newSeason, { name: '', startDate: '', endDate: '' })
}, 'Seizoen toegevoegd', refreshSeasons)

const addClosure = () => act(async () => {
  await $fetch('/api/no-training-periods', { method: 'POST', body: { ...newClosure } })
  Object.assign(newClosure, { startDate: '', endDate: '', reason: '' })
}, 'Sluitingsperiode ingesteld (trainingen in de periode zijn afgelast)', refreshPeriods)

const removeClosure = (id: string) => act(() =>
  $fetch(`/api/no-training-periods/${id}`, { method: 'DELETE' }), 'Sluitingsperiode verwijderd', refreshPeriods)

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL')
}
</script>

<template>
  <UContainer class="max-w-3xl py-16 space-y-6">
    <h1 class="text-2xl font-bold">
      Beheer
    </h1>

    <UCard v-if="!clubData?.club">
      <template #header>
        <h2 class="font-semibold">
          Club aanmaken
        </h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Er is nog geen club. Maak de club aan; jij wordt automatisch beheerder.
        </p>
        <UFormField label="Naam">
          <UInput
            v-model="newClub.name"
            class="w-full"
            placeholder="FC Aalsmeer"
          />
        </UFormField>
        <UFormField
          label="Slug"
          hint="korte naam voor in de URL, bijv. fcaalsmeer"
        >
          <UInput
            v-model="newClub.slug"
            class="w-full"
            placeholder="fcaalsmeer"
          />
        </UFormField>
        <UButton
          label="Club aanmaken"
          :loading="creating"
          @click="createClub"
        />
      </div>
    </UCard>

    <template v-else>
      <UAlert
        v-if="!isAdmin"
        color="warning"
        variant="subtle"
        title="Alleen beheerders kunnen hier wijzigingen doen."
      />

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Club
          </h2>
        </template>
        <UFormField label="Naam">
          <div class="flex gap-2">
            <UInput
              v-model="clubName"
              class="w-full"
              :disabled="!isAdmin"
            />
            <UButton
              label="Opslaan"
              :loading="savingClub"
              :disabled="!isAdmin"
              @click="saveClub"
            />
          </div>
        </UFormField>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Teams
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newTeamName"
              class="w-full"
              placeholder="Nieuw team, bijv. MO17-4"
            />
            <UButton
              label="Toevoegen"
              :loading="creatingTeam"
              @click="createTeam"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="team in teamsData?.teams || []"
              :key="team.id"
              class="flex items-center justify-between py-2"
            >
              <NuxtLink
                :to="`/admin/teams/${team.id}`"
                class="text-primary"
              >
                {{ team.name }}
                <UBadge
                  v-if="team.archived"
                  color="neutral"
                  variant="subtle"
                  label="gearchiveerd"
                />
              </NuxtLink>
              <UButton
                v-if="isAdmin"
                :label="team.archived ? 'Herstellen' : 'Archiveren'"
                size="xs"
                color="neutral"
                variant="outline"
                @click="setArchived(team.id, !team.archived)"
              />
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Locaties
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newLocation.name"
              class="w-full"
              placeholder="Naam, bijv. Sporthal De Bloemhof"
            />
            <UInput
              v-model="newLocation.address"
              class="w-full"
              placeholder="Adres (optioneel)"
            />
            <UButton
              label="Toevoegen"
              :loading="busyF10"
              @click="addLocation"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="loc in locations || []"
              :key="loc.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ loc.name }} <span class="text-muted text-sm">{{ loc.address }}</span></span>
              <UButton
                v-if="isAdmin"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removeLocation(loc.id)"
              />
            </li>
            <li
              v-if="!locations?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen locaties.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Seizoenen
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newSeason.name"
              class="w-full"
              placeholder="Naam, bijv. 2026-2027"
            />
            <UInput
              v-model="newSeason.startDate"
              type="date"
            />
            <UInput
              v-model="newSeason.endDate"
              type="date"
            />
            <UButton
              label="Toevoegen"
              :loading="busyF10"
              @click="addSeason"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="s in seasons || []"
              :key="s.id"
              class="py-2"
            >
              {{ s.name }} <span class="text-muted text-sm">{{ fmtDate(s.startDate) }} t/m {{ fmtDate(s.endDate) }}</span>
            </li>
            <li
              v-if="!seasons?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen seizoenen.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Sluitingsperiodes (hele club)
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            In deze periodes traint geen enkel team. Bestaande trainingen in de periode worden afgelast; teams kunnen deze grenzen niet omzeilen.
          </p>
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newClosure.startDate"
              type="date"
            />
            <UInput
              v-model="newClosure.endDate"
              type="date"
            />
            <UInput
              v-model="newClosure.reason"
              class="w-full"
              placeholder="Reden, bijv. winterstop"
            />
            <UButton
              label="Instellen"
              :loading="busyF10"
              @click="addClosure"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="p in clubPeriods"
              :key="p.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ fmtDate(p.startDate) }} t/m {{ fmtDate(p.endDate) }} <span class="text-muted text-sm">{{ p.reason }}</span></span>
              <UButton
                v-if="isAdmin"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removeClosure(p.id)"
              />
            </li>
            <li
              v-if="!clubPeriods.length"
              class="py-2 text-muted text-sm"
            >
              Geen sluitingsperiodes.
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </UContainer>
</template>
