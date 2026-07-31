<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const schema = z.object({
  email: z.string().email('Ongeldig e-mailadres')
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const pending = ref(false)
const submitted = ref(false)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  pending.value = true
  await authClient.requestPasswordReset({
    email: event.data.email,
    redirectTo: '/reset-password'
  })
  pending.value = false
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
      <p>Als dit e-mailadres bekend is, hebben we een link gestuurd om je wachtwoord opnieuw in te stellen.</p>
    </UCard>

    <UCard v-else>
      <template #header>
        <h1 class="text-xl font-semibold">
          Wachtwoord vergeten
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
        <UButton
          type="submit"
          label="Verstuur herstel-link"
          block
          :loading="pending"
        />
      </UForm>
    </UCard>
  </UContainer>
</template>
