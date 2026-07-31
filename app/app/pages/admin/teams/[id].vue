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
    </template>
  </UContainer>
</template>
