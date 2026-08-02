<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, isAdmin } = useAdminCtx()
const { data: teamsData, refresh: refreshTeams } = await useFetch('/api/teams', { query: { archived: '1' } })

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
  <div class="space-y-6">
    <UAlert
      v-if="!clubData?.club"
      color="warning"
      variant="subtle"
      title="Maak eerst de club aan (Club)."
    />
    <template v-else>
      <UAlert
        v-if="!isAdmin"
        color="warning"
        variant="subtle"
        title="Alleen clubbeheerders kunnen hier wijzigingen doen."
      />
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
  </div>
</template>
