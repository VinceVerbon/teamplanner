<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const schema = z.object({
  name: z.string().min(2, 'Vul je naam in'),
  email: z.string().email('Ongeldig e-mailadres'),
  dateOfBirth: z.string().optional(),
  password: z.string().min(8, 'Minimaal 8 tekens')
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const submitted = ref(false)
const pending = ref(false)
const errorMsg = ref('')

async function onSubmit(event: FormSubmitEvent<Schema>) {
  pending.value = true
  errorMsg.value = ''
  const { error } = await authClient.signUp.email({
    name: event.data.name,
    email: event.data.email,
    password: event.data.password,
    ...(event.data.dateOfBirth ? { dateOfBirth: new Date(event.data.dateOfBirth) } : {})
  } as never)
  pending.value = false
  if (error) {
    errorMsg.value = error.message || 'Registreren is niet gelukt.'
    return
  }
  submitted.value = true
}
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard v-if="submitted">
      <template #header>
        <h1 class="text-xl font-semibold">
          Controleer je mail
        </h1>
      </template>
      <p>We hebben je een verificatiemail gestuurd. Klik op de link in die mail om je account te activeren.</p>
    </UCard>

    <UCard v-else>
      <template #header>
        <h1 class="text-xl font-semibold">
          Registreren
        </h1>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Naam"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autocomplete="name"
          />
        </UFormField>
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
          label="Geboortedatum"
          name="dateOfBirth"
          hint="verplicht voor spelers"
        >
          <UInput
            v-model="state.dateOfBirth"
            type="date"
            class="w-full"
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
          label="Account aanmaken"
          block
          :loading="pending"
        />
      </UForm>

      <template #footer>
        <p class="text-sm text-muted">
          Al een account?
          <NuxtLink
            to="/login"
            class="text-primary"
          >Inloggen</NuxtLink>
        </p>
      </template>
    </UCard>
  </UContainer>
</template>
