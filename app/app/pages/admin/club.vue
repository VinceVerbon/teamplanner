<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, refreshClub, isAdmin, isInstanceAdmin } = useAdminCtx()

// F26: creating a club is an instance-level action.
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
</script>

<template>
  <div class="space-y-6">
    <UCard v-if="!clubData?.club">
      <template #header>
        <h2 class="font-semibold">
          Club aanmaken
        </h2>
      </template>
      <div class="space-y-4">
        <template v-if="isInstanceAdmin">
          <p class="text-sm text-muted">
            Er is nog geen club. Maak de club aan; jij wordt automatisch clubbeheerder.
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
        </template>
        <UAlert
          v-else
          color="warning"
          variant="subtle"
          title="Er is nog geen club. Alleen een systeembeheerder kan de club aanmaken."
        />
      </div>
    </UCard>

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
            Club
          </h2>
        </template>
        <div class="space-y-4">
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
          <p class="text-sm text-muted">
            Het clubadres stel je in bij <NuxtLink
              to="/admin/locations"
              class="text-primary"
            >Locaties</NuxtLink> door een locatie als hoofdlocatie te markeren.
          </p>
        </div>
      </UCard>
    </template>
  </div>
</template>
