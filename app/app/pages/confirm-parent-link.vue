<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const state = ref<'confirming' | 'done' | 'failed'>('confirming')
const errorMsg = ref('')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    state.value = 'failed'
    errorMsg.value = 'Er ontbreekt een token in de link. Gebruik de link uit de mail.'
    return
  }
  try {
    await $fetch('/api/parent-links/confirm', { method: 'POST', body: { token } })
    state.value = 'done'
  } catch (e: unknown) {
    state.value = 'failed'
    const status = (e as { statusCode?: number }).statusCode
    errorMsg.value = status === 403
      ? 'Deze bevestiging is aan de andere partij gericht. Log in met het account waar de mail naartoe is gestuurd.'
      : 'Deze koppeling bestaat niet (meer) of is al bevestigd.'
  }
})
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold">
          Ouder-speler koppeling
        </h1>
      </template>

      <p v-if="state === 'confirming'">
        Bezig met bevestigen...
      </p>

      <div
        v-else-if="state === 'done'"
        class="space-y-4"
      >
        <UAlert
          color="success"
          variant="subtle"
          title="Koppeling bevestigd"
          description="De ouder-speler koppeling is nu actief."
        />
        <UButton
          to="/account"
          label="Naar mijn account"
        />
      </div>

      <div
        v-else
        class="space-y-4"
      >
        <UAlert
          color="error"
          variant="subtle"
          title="Bevestigen is niet gelukt"
          :description="errorMsg"
        />
        <UButton
          to="/account"
          label="Naar mijn account"
          variant="outline"
        />
      </div>
    </UCard>
  </UContainer>
</template>
