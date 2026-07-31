<script setup lang="ts">
const session = authClient.useSession()
</script>

<template>
  <UPageHero
    title="teamplanner"
    description="Trainingen, wedstrijden en aanwezigheid voor je team - op een plek. Registreer je, zie het komende schema en meld je af als je er niet bij kunt zijn."
    :links="session.data?.user
      ? [{ label: 'Mijn account', to: '/account', trailingIcon: 'i-lucide-arrow-right', size: 'xl' }]
      : [
        { label: 'Registreren', to: '/register', trailingIcon: 'i-lucide-arrow-right', size: 'xl' },
        { label: 'Inloggen', to: '/login', size: 'xl', color: 'neutral', variant: 'subtle' }
      ]"
  />
</template>
