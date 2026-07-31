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
    </template>
  </UContainer>
</template>
