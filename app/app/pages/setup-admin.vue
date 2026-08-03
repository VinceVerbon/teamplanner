<script setup lang="ts">
// F22: first-run setup - set the password of the seeded default admin. Only reachable
// while that password is still empty; afterwards the server answers 410 and this page
// bounces to /login.
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { passwordStrength, STRENGTH_LABELS } from '#shared/utils/password-strength'

const { data: bootstrap } = await useFetch('/api/bootstrap/status')

const schema = z.object({
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
    const { email } = await $fetch('/api/bootstrap/password', {
      method: 'POST',
      body: { newPassword: event.data.password }
    })
    const { error } = await authClient.signIn.email({ email, password: event.data.password })
    await navigateTo(error ? '/login' : '/admin')
  } catch (err) {
    const e = err as { statusCode?: number, statusMessage?: string }
    errorMsg.value = e.statusCode === 410
      ? 'De eerste installatie is al afgerond. Log gewoon in.'
      : e.statusMessage || 'Instellen is niet gelukt.'
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
          Beheerderswachtwoord instellen
        </h1>
      </template>

      <div
        v-if="!bootstrap?.pending"
        class="space-y-4"
      >
        <UAlert
          color="info"
          variant="subtle"
          title="De eerste installatie is al afgerond."
        />
        <UButton
          label="Naar inloggen"
          to="/login"
          block
        />
      </div>

      <UForm
        v-else
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <p class="text-sm text-muted">
          Dit is de eerste keer dat de app draait. Stel nu het wachtwoord in voor het
          standaard beheerdersaccount <strong>{{ bootstrap.email }}</strong>. Zonder dit
          wachtwoord kan er niets beheerd worden.
        </p>
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
          label="Herhaal wachtwoord"
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
          label="Wachtwoord instellen en inloggen"
          block
          :loading="pending"
        />
      </UForm>
    </UCard>
  </UContainer>
</template>
