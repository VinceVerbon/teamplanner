<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data: me, refresh } = await useFetch('/api/me')

const editName = ref('')
const saving = ref(false)
const toast = useToast()

watchEffect(() => {
  if (me.value?.user) editName.value = me.value.user.name
})

async function saveName() {
  saving.value = true
  const { error } = await authClient.updateUser({ name: editName.value })
  saving.value = false
  if (error) {
    toast.add({ title: 'Opslaan is niet gelukt', color: 'error' })
    return
  }
  toast.add({ title: 'Opgeslagen' })
  await refresh()
}
</script>

<template>
  <UContainer class="max-w-2xl py-16 space-y-6">
    <h1 class="text-2xl font-bold">
      Mijn account
    </h1>

    <UCard v-if="me">
      <template #header>
        <h2 class="font-semibold">
          Profiel
        </h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Naam">
          <div class="flex gap-2">
            <UInput
              v-model="editName"
              class="w-full"
            />
            <UButton
              label="Opslaan"
              :loading="saving"
              @click="saveName"
            />
          </div>
        </UFormField>
        <UFormField label="E-mailadres">
          <p>
            {{ me.user.email }} <UBadge
              v-if="me.user.emailVerified"
              color="success"
              variant="subtle"
              label="geverifieerd"
            />
          </p>
        </UFormField>
        <UFormField
          v-if="(me.user as Record<string, unknown>).dateOfBirth"
          label="Geboortedatum"
        >
          <p>{{ new Date(String((me.user as Record<string, unknown>).dateOfBirth)).toLocaleDateString('nl-NL') }}</p>
        </UFormField>
      </div>
    </UCard>

    <UCard v-if="me">
      <template #header>
        <h2 class="font-semibold">
          Mijn rollen
        </h2>
      </template>
      <ul class="space-y-1 text-sm">
        <li v-if="me.roles.adminOfClubIds.length">
          Beheerder van de club
        </li>
        <li v-if="me.roles.playerTeamId">
          Speler
        </li>
        <li v-if="me.roles.staffTeamIds.length">
          Staflid van {{ me.roles.staffTeamIds.length }} team(s)
        </li>
        <li
          v-if="me.roles.pendingStaffTeamIds.length"
          class="text-muted"
        >
          Staf-aanmelding wacht op goedkeuring van de beheerder
        </li>
        <li v-if="me.roles.parentOfUserIds.length">
          Ouder van {{ me.roles.parentOfUserIds.length }} speler(s)
        </li>
        <li
          v-if="!me.roles.adminOfClubIds.length && !me.roles.playerTeamId && !me.roles.staffTeamIds.length && !me.roles.parentOfUserIds.length"
          class="text-muted"
        >
          Nog geen rollen - een beheerder of teamstaf wijst je toe aan een team.
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
