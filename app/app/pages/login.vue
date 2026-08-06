<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const schema = z.object({
  email: z.string().email('Ongeldig e-mailadres'),
  password: z.string().min(1, 'Vul je wachtwoord in')
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const pending = ref(false)
const errorMsg = ref('')
const googleEnabled = useRuntimeConfig().public.googleEnabled
const route = useRoute()

// Only follow internal redirect targets (no protocol-relative or absolute URLs).
function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/account'
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  pending.value = true
  errorMsg.value = ''
  const { error } = await authClient.signIn.email({
    email: event.data.email,
    password: event.data.password
  })
  pending.value = false
  if (error) {
    errorMsg.value = error.status === 403
      ? 'Je e-mailadres is nog niet geverifieerd. Controleer je mail.'
      : 'Inloggen is niet gelukt. Controleer je gegevens.'
    return
  }
  await navigateTo(redirectTarget())
}

async function googleLogin() {
  await authClient.signIn.social({ provider: 'google', callbackURL: redirectTarget() })
}
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold">
          Inloggen
        </h1>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="E-mailadres"
          name="email"
          required
        >
          <UInput
            v-model="state.email"
            type="email"
            class="w-full"
            autocomplete="email"
          />
        </UFormField>
        <UFormField
          label="Wachtwoord"
          name="password"
          required
        >
          <UInput
            v-model="state.password"
            type="password"
            class="w-full"
            autocomplete="current-password"
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
          label="Inloggen"
          block
          :loading="pending"
        />
        <UButton
          v-if="googleEnabled"
          label="Verder met Google"
          icon="i-simple-icons-google"
          color="neutral"
          variant="outline"
          block
          @click="googleLogin"
        />
      </UForm>

      <template #footer>
        <div class="flex justify-between text-sm text-muted">
          <NuxtLink
            to="/register"
            class="text-primary"
          >Registreren</NuxtLink>
          <NuxtLink
            to="/forgot-password"
            class="text-primary"
          >Wachtwoord vergeten?</NuxtLink>
        </div>
      </template>
    </UCard>
  </UContainer>
</template>
