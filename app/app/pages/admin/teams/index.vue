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

// F30: team import from voetbal.nl - admin logs in with their own voetbal.nl
// account; credentials go to the server for this action only and are not stored.
interface VnlPreviewRow {
  voetbalnlId: string
  name: string
  category: string
  suggestedName: string
  alreadyExists: boolean
}
const vnlEmail = ref('')
const vnlPassword = ref('')
const vnlPreview = ref<VnlPreviewRow[] | null>(null)
const vnlSelected = ref<Set<string>>(new Set())
const vnlLoading = ref(false)
const vnlImporting = ref(false)

const vnlCategories = computed(() => {
  const groups: { category: string, rows: VnlPreviewRow[] }[] = []
  for (const row of vnlPreview.value || []) {
    const group = groups.find(g => g.category === row.category)
    if (group) group.rows.push(row)
    else groups.push({ category: row.category, rows: [row] })
  }
  return groups
})

async function vnlFetchTeams() {
  vnlLoading.value = true
  try {
    const res = await $fetch<{ rows: VnlPreviewRow[] }>('/api/voetbalnl/import-preview', {
      method: 'POST',
      body: { email: vnlEmail.value, password: vnlPassword.value }
    })
    vnlPreview.value = res.rows
    vnlSelected.value = new Set(res.rows.filter(r => !r.alreadyExists).map(r => r.suggestedName))
    vnlPassword.value = ''
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Ophalen van teams is niet gelukt', color: 'error' })
  } finally {
    vnlLoading.value = false
  }
}

function vnlToggle(row: VnlPreviewRow) {
  const next = new Set(vnlSelected.value)
  if (next.has(row.suggestedName)) next.delete(row.suggestedName)
  else next.add(row.suggestedName)
  vnlSelected.value = next
}

async function vnlImport() {
  vnlImporting.value = true
  try {
    const res = await $fetch<{ imported: number, skipped: number }>('/api/voetbalnl/import', {
      method: 'POST',
      body: { names: [...vnlSelected.value] }
    })
    toast.add({ title: `${res.imported} team(s) aangemaakt, ${res.skipped} overgeslagen`, color: 'success' })
    vnlPreview.value = null
    vnlSelected.value = new Set()
    await refreshTeams()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Importeren is niet gelukt', color: 'error' })
  } finally {
    vnlImporting.value = false
  }
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
      <UCard v-if="isAdmin">
        <template #header>
          <h2 class="font-semibold">
            Importeren uit voetbal.nl
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Haal de teams van de club op via je eigen voetbal.nl-account. Je inloggegevens
            worden alleen voor deze actie gebruikt en nergens opgeslagen. Handmatig
            toevoegen blijft altijd mogelijk.
          </p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UInput
              v-model="vnlEmail"
              class="w-full"
              type="email"
              autocomplete="off"
              placeholder="E-mailadres voetbal.nl"
            />
            <UInput
              v-model="vnlPassword"
              class="w-full"
              type="password"
              autocomplete="off"
              placeholder="Wachtwoord voetbal.nl"
            />
            <UButton
              label="Teams ophalen"
              :loading="vnlLoading"
              :disabled="!vnlEmail || !vnlPassword"
              @click="vnlFetchTeams"
            />
          </div>
          <template v-if="vnlPreview">
            <div
              v-for="group in vnlCategories"
              :key="group.category"
              class="space-y-1"
            >
              <h3 class="text-sm font-medium text-muted">
                {{ group.category }}
              </h3>
              <ul class="divide-y divide-default">
                <li
                  v-for="row in group.rows"
                  :key="row.voetbalnlId"
                  class="flex items-center justify-between py-2"
                >
                  <UCheckbox
                    :model-value="vnlSelected.has(row.suggestedName)"
                    :disabled="row.alreadyExists"
                    :label="row.suggestedName"
                    :description="row.name"
                    @update:model-value="vnlToggle(row)"
                  />
                  <UBadge
                    v-if="row.alreadyExists"
                    color="neutral"
                    variant="subtle"
                    label="bestaat al"
                  />
                </li>
              </ul>
            </div>
            <UButton
              :label="`Importeer ${vnlSelected.size} team(s)`"
              :disabled="!vnlSelected.size"
              :loading="vnlImporting"
              @click="vnlImport"
            />
          </template>
        </div>
      </UCard>
    </template>
  </div>
</template>
