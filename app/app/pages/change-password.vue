<script setup lang="ts">
// Own-password change. Also the landing page of the forced first-login change (F22/F23):
// the global middleware routes here while mustSetPassword is set, and the server blocks
// every other API until it is cleared.
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { passwordStrength, STRENGTH_LABELS } from '../../shared/utils/password-strength'

definePageMeta({ middleware: 'auth' })

const me = useMe()
onMounted(refreshMe)
const forced = computed(() => !!me.value?.settings?.mustSetPassword)

const schema = z.object({
  currentPassword: z.string().min(1, 'Vul je huidige wachtwoord in'),
  password: z.string().min(8, 'Minimaal 8 tekens'),
  confirm: z.string()
}).refine(d => d.password === d.confirm, { message: 'Wachtwoorden zijn niet gelijk', path: ['confirm'] })
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const pending = ref(false)
const errorMsg = ref('')
const strengthLabel = computed(() =>
  state.password ? STRENGTH_LABELS[passwordStrength(state.password)] : '')

async function onSubmit(event: FormSubmitEvent<Schema>) {
  pending.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/me/password', {
      method: 'POST',
      body: { currentPassword: event.data.currentPassword, newPassword: event.data.password }
    })
    await refreshMe()
    await navigateTo('/account')
  } catch (err) {
    const e = err as { statusCode?: number, statusMessage?: string, data?: { message?: string } }
    errorMsg.value = e.data?.message || e.statusMessage || 'Wijzigen is niet gelukt. Controleer je huidige wachtwoord.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold">
          Wachtwoord wijzigen
        </h1>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UAlert
          v-if="forced"
          color="info"
          variant="subtle"
          title="Stel eerst een nieuw wachtwoord in"
          description="Je account is aangemaakt met een tijdelijk wachtwoord. Kies een eigen wachtwoord om verder te kunnen."
        />
        <UFormField
          label="Huidig wachtwoord"
          name="currentPassword"
          required
        >
          <UInput
            v-model="state.currentPassword"
            type="password"
            class="w-full"
            autocomplete="current-password"
          />
        </UFormField>
        <UFormField
          label="Nieuw wachtwoord"
          name="password"
          required
          :hint="strengthLabel ? `sterkte: ${strengthLabel}` : undefined"
        >
          <UInput
            v-model="state.password"
            type="password"
            class="w-full"
            autocomplete="new-password"
          />
        </UFormField>
        <UFormField
          label="Herhaal nieuw wachtwoord"
          name="confirm"
          required
        >
          <UInput
            v-model="state.confirm"
            type="password"
            class="w-full"
            autocomplete="new-password"
          />
        </UFormField>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="subtle"
          :title="errorMsg"
        />

        <UButton
          type="submit"
          label="Wachtwoord wijzigen"
          block
          :loading="pending"
        />
      </UForm>
    </UCard>
  </UContainer>
</template>
