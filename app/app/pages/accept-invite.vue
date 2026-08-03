<script setup lang="ts">
// F9: landing page of the mailed invitation link. A new user registers in place
// (email fixed by the invitation); a logged-in user with the matching email accepts
// directly. No auth middleware: the invitee has no account yet.
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

interface InviteInfo {
  status: 'pending' | 'accepted' | 'cancelled' | 'expired'
  email: string
  role: 'player' | 'staff'
  teamName: string | null
  clubName: string | null
  accountExists: boolean
}

const route = useRoute()
const me = useMe()
const token = typeof route.query.token === 'string' ? route.query.token : ''

const phase = ref<'loading' | 'invalid' | 'pending' | 'accepted'>('loading')
const invalidMsg = ref('')
const info = ref<InviteInfo | null>(null)
const pending = ref(false)
const errorMsg = ref('')

const roleText = computed(() => info.value?.role === 'player' ? 'speler' : 'staflid')
const loggedInMatch = computed(() => !!me.value && me.value.user.email === info.value?.email)
const loggedInMismatch = computed(() => !!me.value && me.value.user.email !== info.value?.email)

const schema = z.object({
  name: z.string().min(2, 'Vul je naam in'),
  dateOfBirth: z.string().optional(),
  password: z.string().min(8, 'Minimaal 8 tekens')
})
type Schema = z.output<typeof schema>
const state = reactive<Partial<Schema>>({})

const INVALID_TEXT: Record<string, string> = {
  accepted: 'Deze uitnodiging is al gebruikt.',
  cancelled: 'Deze uitnodiging is ingetrokken.',
  expired: 'Deze uitnodiging is verlopen. Vraag een nieuwe aan bij je club.'
}

onMounted(async () => {
  if (!token) {
    invalidMsg.value = 'Deze link is onvolledig: er ontbreekt een uitnodigingscode.'
    phase.value = 'invalid'
    return
  }
  await refreshMe()
  try {
    info.value = await $fetch<InviteInfo>('/api/invitations/lookup', { query: { token } })
  } catch {
    invalidMsg.value = 'Uitnodiging niet gevonden of niet meer geldig.'
    phase.value = 'invalid'
    return
  }
  if (info.value.status !== 'pending') {
    invalidMsg.value = INVALID_TEXT[info.value.status] ?? 'Deze uitnodiging is niet meer geldig.'
    phase.value = 'invalid'
    return
  }
  phase.value = 'pending'
})

function apiError(err: unknown): string {
  const e = err as { data?: { statusMessage?: string, message?: string } }
  return e?.data?.statusMessage || e?.data?.message || 'Er is iets misgegaan.'
}

async function acceptLoggedIn() {
  pending.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/invitations/accept', { method: 'POST', body: { token } })
    await refreshMe()
    phase.value = 'accepted'
  } catch (err) {
    errorMsg.value = apiError(err)
  } finally {
    pending.value = false
  }
}

async function onRegister(event: FormSubmitEvent<Schema>) {
  pending.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/invitations/accept', {
      method: 'POST',
      body: {
        token,
        registration: {
          name: event.data.name,
          password: event.data.password,
          dateOfBirth: event.data.dateOfBirth || null
        }
      }
    })
    // The account exists and is verified; sign in with the just-chosen password.
    await authClient.signIn.email({ email: info.value!.email, password: event.data.password })
    await refreshMe()
    phase.value = 'accepted'
  } catch (err) {
    errorMsg.value = apiError(err)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-md py-16">
    <UCard v-if="phase === 'loading'">
      <p class="text-muted">
        Uitnodiging controleren...
      </p>
    </UCard>

    <UCard v-else-if="phase === 'invalid'">
      <template #header>
        <h1 class="text-xl font-semibold">
          Uitnodiging
        </h1>
      </template>
      <UAlert
        color="warning"
        variant="subtle"
        :title="invalidMsg"
      />
      <template #footer>
        <NuxtLink
          to="/"
          class="text-sm text-primary"
        >Naar de startpagina</NuxtLink>
      </template>
    </UCard>

    <UCard v-else-if="phase === 'accepted'">
      <template #header>
        <h1 class="text-xl font-semibold">
          Welkom bij {{ info?.teamName }}!
        </h1>
      </template>
      <p>
        Je bent aangemeld als {{ roleText }} van {{ info?.teamName }}<span v-if="info?.clubName"> ({{ info.clubName }})</span>.
      </p>
      <template #footer>
        <UButton
          to="/"
          label="Naar mijn team"
        />
      </template>
    </UCard>

    <UCard v-else>
      <template #header>
        <h1 class="text-xl font-semibold">
          Uitnodiging voor {{ info?.teamName }}
        </h1>
      </template>

      <p class="mb-4">
        Je bent uitgenodigd als <strong>{{ roleText }}</strong> van {{ info?.teamName }}<span v-if="info?.clubName"> ({{ info.clubName }})</span>, op het adres <strong>{{ info?.email }}</strong>.
      </p>

      <!-- Logged in with the invited address: accept directly. -->
      <div v-if="loggedInMatch">
        <UButton
          label="Uitnodiging accepteren"
          block
          :loading="pending"
          @click="acceptLoggedIn"
        />
      </div>

      <!-- Logged in as someone else: this invitation is not addressed to this account. -->
      <UAlert
        v-else-if="loggedInMismatch"
        color="warning"
        variant="subtle"
        title="Deze uitnodiging is gericht aan een ander e-mailadres."
        :description="`Je bent ingelogd als ${me?.user.email}. Log uit en open de link uit de mail opnieuw.`"
      />

      <!-- Not logged in, account exists: sign in first, then land back here. -->
      <div v-else-if="info?.accountExists">
        <UAlert
          color="info"
          variant="subtle"
          title="Er bestaat al een account met dit e-mailadres."
          class="mb-4"
        />
        <UButton
          :to="`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`"
          label="Inloggen om te accepteren"
          block
        />
      </div>

      <!-- New user: register in place; the email is fixed by the invitation. -->
      <UForm
        v-else
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onRegister"
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
          label="Geboortedatum"
          name="dateOfBirth"
          :required="info?.role === 'player'"
          :hint="info?.role === 'player' ? 'verplicht voor spelers' : undefined"
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
          v-if="errorMsg && !pending"
          color="error"
          variant="subtle"
          :title="errorMsg"
        />

        <UButton
          type="submit"
          label="Account aanmaken en accepteren"
          block
          :loading="pending"
        />
      </UForm>

      <UAlert
        v-if="errorMsg && (loggedInMatch || loggedInMismatch)"
        color="error"
        variant="subtle"
        :title="errorMsg"
        class="mt-4"
      />
    </UCard>
  </UContainer>
</template>
