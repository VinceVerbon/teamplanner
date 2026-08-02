<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, refreshClub, isAdmin } = useAdminCtx()

const { data: locations, refresh: refreshLocations } = await useFetch('/api/locations')
const mainLocationId = computed(() => clubData.value?.club?.mainLocationId ?? null)

const newLocation = reactive({ name: '', address: '' })
const busy = ref(false)

async function act(fn: () => Promise<unknown>, okMsg: string) {
  busy.value = true
  try {
    await fn()
    toast.add({ title: okMsg })
    await Promise.all([refreshLocations(), refreshClub()])
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    busy.value = false
  }
}

const addLocation = () => act(async () => {
  await $fetch('/api/locations', { method: 'POST', body: { ...newLocation } })
  Object.assign(newLocation, { name: '', address: '' })
}, 'Locatie toegevoegd')

const removeLocation = (id: string) => act(() =>
  $fetch(`/api/locations/${id}`, { method: 'DELETE' }), 'Locatie verwijderd')

// F27: club locations (checkmark) and the single main location (the club's own address).
const setClubLocation = (id: string, isClubLocation: boolean) => act(() =>
  $fetch(`/api/locations/${id}`, { method: 'PATCH', body: { isClubLocation } }),
isClubLocation ? 'Gemarkeerd als clublocatie' : 'Clublocatie-markering verwijderd')

const setMain = (locationId: string | null) => act(() =>
  $fetch(`/api/clubs/${clubData.value!.club!.id}/main-location`, {
    method: 'PATCH', body: { locationId }
  }), locationId ? 'Hoofdlocatie ingesteld' : 'Hoofdlocatie verwijderd')
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
            Locaties
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Markeer eigen accommodaties als <strong>clublocatie</strong>. Precies een
            clublocatie is de <strong>hoofdlocatie</strong>: het adres van de club zelf.
          </p>
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
              :loading="busy"
              @click="addLocation"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="loc in locations || []"
              :key="loc.id"
              class="py-3 flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <div class="flex-1 min-w-0">
                <span>{{ loc.name }}</span>
                <span class="text-muted text-sm ml-2">{{ loc.address }}</span>
                <UBadge
                  v-if="loc.id === mainLocationId"
                  color="primary"
                  variant="subtle"
                  label="hoofdlocatie"
                  class="ml-2"
                />
              </div>
              <div class="flex items-center gap-3">
                <UCheckbox
                  :model-value="loc.isClubLocation"
                  label="clublocatie"
                  :disabled="!isAdmin || busy"
                  @update:model-value="v => setClubLocation(loc.id, v === true)"
                />
                <UButton
                  v-if="isAdmin && loc.id !== mainLocationId"
                  label="Maak hoofdlocatie"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :disabled="busy"
                  @click="setMain(loc.id)"
                />
                <UButton
                  v-else-if="isAdmin && loc.id === mainLocationId"
                  label="Geen hoofdlocatie"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="busy"
                  @click="setMain(null)"
                />
                <UButton
                  v-if="isAdmin"
                  label="Verwijderen"
                  size="xs"
                  color="error"
                  variant="outline"
                  :disabled="busy"
                  @click="removeLocation(loc.id)"
                />
              </div>
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
    </template>
  </div>
</template>
