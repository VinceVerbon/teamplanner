<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  htmlAttrs: { lang: 'nl' }
})

useSeoMeta({
  title: 'teamplanner',
  description: 'Team planning: trainingen, wedstrijden en aanwezigheid voor je club.'
})

const session = authClient.useSession()
const me = useMe()

watch(() => session.value.data?.user?.id, (id) => {
  if (id) refreshMe()
  else me.value = null
}, { immediate: true })

const canManage = computed(() =>
  !!me.value && (me.value.roles.adminOfClubIds.length > 0 || me.value.roles.staffTeamIds.length > 0))

async function logout() {
  await authClient.signOut()
  me.value = null
  await navigateTo('/login')
}
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="font-bold text-lg"
        >
          teamplanner
        </NuxtLink>
      </template>

      <template #right>
        <UColorModeButton />
        <template v-if="session.data?.user">
          <UButton
            v-if="canManage"
            to="/admin"
            icon="i-lucide-settings"
            variant="ghost"
            color="neutral"
            label="Beheer"
          />
          <UButton
            to="/account"
            icon="i-lucide-user"
            variant="ghost"
            color="neutral"
            :label="session.data.user.name"
          />
          <UButton
            icon="i-lucide-log-out"
            variant="ghost"
            color="neutral"
            aria-label="Uitloggen"
            @click="logout"
          />
        </template>
        <template v-else>
          <UButton
            to="/login"
            label="Inloggen"
            variant="ghost"
            color="neutral"
          />
          <UButton
            to="/register"
            label="Registreren"
          />
        </template>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
