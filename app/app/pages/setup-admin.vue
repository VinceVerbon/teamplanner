<script setup lang="ts">
// F22/F31: first-run setup - set the password of the seeded default admin. Only
// reachable via the installation link /setup-admin?token=<BOOTSTRAP_TOKEN> (the token
// comes from the deploy environment; the server compares it timing-safe). Without a
// valid token the API answers 404/401 and this page only shows a generic notice.
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { passwordStrength, STRENGTH_LABELS } from '#shared/utils/password-strength'

const route = useRoute()
const token = typeof route.query.token === 'string' ? route.query.token : ''

const { data: bootstrap } = await useFetch('/api/bootstrap/status', {
  headers: { 'x-bootstrap-token': token },
  // Without (or with a wrong) token the server answers 404/401; treat as "not open".
  ignoreResponseError: false,
  server: false,
  immediate: !!token
})

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
      headers: { 'x-bootstrap-token': token },
      body: { newPassword: event.data.password }
    })
    const { error } = await authClient.signIn.email({ email, password: event.data.password })
    await navigateTo(error ? '/login' : '/admin')
  } catch (err) {
    const e = err as { statusCode?: number, statusMessage?: string }
    errorMsg.value = e.statusCode === 410
      ? 'De eerste installatie is al afgerond. Log gewoon in.'
      : e.statusCode === 401 || e.statusCode === 404
        ? 'Ongeldige installatielink. Gebruik de link met de BOOTSTRAP_TOKEN uit de deploy-omgeving.'
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
        v-if="!token || !bootstrap?.pending"
        class="space-y-4"
      >
        <UAlert
          color="info"
          variant="subtle"
          :title="token
            ? 'Er is hier niets in te stellen.'
            : 'Deze pagina werkt alleen via de installatielink.'"
          :description="token
            ? 'De eerste installatie is al afgerond, of de installatielink is ongeldig.'
            : 'Open /setup-admin?token=<BOOTSTRAP_TOKEN> met het token uit de deploy-omgeving.'"
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
          standaard beheerdersaccount. Zonder dit wachtwoord kan er niets beheerd worden.
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
