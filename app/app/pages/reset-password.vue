<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const schema = z.object({
  password: z.string().min(8, 'Minimaal 8 tekens')
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const pending = ref(false)
const errorMsg = ref('')
const route = useRoute()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const token = String(route.query.token || '')
  if (!token) {
    errorMsg.value = 'Ongeldige of verlopen link. Vraag een nieuwe herstel-link aan.'
    return
  }
  pending.value = true
  errorMsg.value = ''
  const { error } = await authClient.resetPassword({
    newPassword: event.data.password,
    token
  })
  pending.value = false
  if (error) {
    errorMsg.value = 'Ongeldige of verlopen link. Vraag een nieuwe herstel-link aan.'
    return
  }
  await navigateTo('/login')
}
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold">
          Nieuw wachtwoord instellen
        </h1>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Nieuw wachtwoord"
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
          label="Wachtwoord opslaan"
          block
          :loading="pending"
        />
      </UForm>
    </UCard>
  </UContainer>
</template>
