<script setup lang="ts">
import { passwordStrength, STRENGTH_LABELS, type PasswordPolicy } from '../../../shared/utils/password-strength'

definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, refreshClub, isAdmin, isInstanceAdmin } = useAdminCtx()
const canCreateAccounts = computed(() => isAdmin.value || isInstanceAdmin.value)

// F23: create an account directly (no self-registration, no verification mail).
const newAccount = reactive({ name: '', email: '', dateOfBirth: '', password: '', mustChangePassword: true })
const creatingAccount = ref(false)
const newAccountStrength = computed(() =>
  newAccount.password ? STRENGTH_LABELS[passwordStrength(newAccount.password)] : '')

async function createAccount() {
  creatingAccount.value = true
  try {
    const created = await $fetch('/api/users', {
      method: 'POST',
      body: {
        name: newAccount.name,
        email: newAccount.email,
        password: newAccount.password,
        dateOfBirth: newAccount.dateOfBirth || null,
        mustChangePassword: newAccount.mustChangePassword
      }
    })
    toast.add({ title: `Account aangemaakt voor ${created.email}` })
    Object.assign(newAccount, { name: '', email: '', dateOfBirth: '', password: '', mustChangePassword: true })
  } catch (err) {
    toast.add({ title: (err as { statusMessage?: string }).statusMessage || 'Aanmaken is niet gelukt', color: 'error' })
  } finally {
    creatingAccount.value = false
  }
}

// F24: enforced password standard; lowering below 'medium' needs explicit confirmation.
const policyItems = [
  { label: 'Laag (minimaal 8 tekens)', value: 'low' },
  { label: 'Middel (standaard)', value: 'medium' },
  { label: 'Sterk', value: 'strong' }
]
const passwordPolicy = ref<PasswordPolicy>('medium')
watchEffect(() => {
  const p = clubData.value?.club?.passwordPolicy
  if (p) passwordPolicy.value = p as PasswordPolicy
})
const confirmLowPolicy = ref(false)

async function persistPolicy(policy: PasswordPolicy) {
  const clubId = clubData.value?.club?.id
  if (!clubId) return
  try {
    await $fetch(`/api/clubs/${clubId}/password-policy`, { method: 'PATCH', body: { policy } })
    toast.add({ title: 'Wachtwoordbeleid opgeslagen' })
    await refreshClub()
  } catch (err) {
    toast.add({ title: (err as { statusMessage?: string }).statusMessage || 'Opslaan is niet gelukt', color: 'error' })
    passwordPolicy.value = (clubData.value?.club?.passwordPolicy as PasswordPolicy) || 'medium'
  }
}

async function onPolicyChange(value: unknown) {
  const policy = value as PasswordPolicy
  const current = (clubData.value?.club?.passwordPolicy as PasswordPolicy) || 'medium'
  if (policy === current) return
  if (policy === 'low') {
    // Are-you-sure gate before a weaker-than-standard policy activates.
    confirmLowPolicy.value = true
    return
  }
  await persistPolicy(policy)
}

async function confirmLowPolicyYes() {
  confirmLowPolicy.value = false
  await persistPolicy('low')
}

function confirmLowPolicyCancel() {
  confirmLowPolicy.value = false
  passwordPolicy.value = (clubData.value?.club?.passwordPolicy as PasswordPolicy) || 'medium'
}
</script>

<template>
  <div class="space-y-6">
    <UCard v-if="canCreateAccounts">
      <template #header>
        <h2 class="font-semibold">
          Account aanmaken
        </h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Maak direct een account aan zonder registratie- en verificatiemail; het
          e-mailadres hoeft niet bevestigd te worden. Geef het wachtwoord door aan het
          lid; standaard moet het lid bij de eerste keer inloggen zelf een nieuw
          wachtwoord instellen.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="Naam">
            <UInput
              v-model="newAccount.name"
              class="w-full"
              placeholder="Voor- en achternaam"
            />
          </UFormField>
          <UFormField label="E-mailadres">
            <UInput
              v-model="newAccount.email"
              type="email"
              class="w-full"
              placeholder="lid@example.com"
            />
          </UFormField>
          <UFormField
            label="Geboortedatum"
            hint="verplicht om als speler ingedeeld te kunnen worden"
          >
            <UInput
              v-model="newAccount.dateOfBirth"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Wachtwoord"
            :hint="newAccountStrength ? `sterkte: ${newAccountStrength}` : undefined"
          >
            <UInput
              v-model="newAccount.password"
              type="text"
              class="w-full"
              autocomplete="off"
            />
          </UFormField>
        </div>
        <UCheckbox
          v-model="newAccount.mustChangePassword"
          label="Moet bij eerste keer inloggen een nieuw wachtwoord instellen"
        />
        <UButton
          label="Account aanmaken"
          :loading="creatingAccount"
          @click="createAccount"
        />
      </div>
    </UCard>
    <UAlert
      v-else
      color="warning"
      variant="subtle"
      title="Alleen club- of systeembeheerders kunnen accounts aanmaken."
    />

    <UCard v-if="clubData?.club">
      <template #header>
        <h2 class="font-semibold">
          Wachtwoordbeleid
        </h2>
      </template>
      <UFormField
        label="Minimale sterkte"
        hint="geldt voor alle nieuwe wachtwoorden; standaard is 'Middel'"
      >
        <USelect
          v-model="passwordPolicy"
          :items="policyItems"
          :disabled="!isAdmin"
          class="w-64"
          @update:model-value="onPolicyChange"
        />
      </UFormField>
    </UCard>

    <UModal
      v-model:open="confirmLowPolicy"
      title="Weet je het zeker?"
    >
      <template #body>
        <p class="text-sm">
          Je verlaagt het wachtwoordbeleid tot onder de standaard. Nieuwe wachtwoorden
          hoeven dan alleen nog minimaal 8 tekens te zijn; zwakke wachtwoorden maken
          accounts kwetsbaarder. Weet je zeker dat je dit wilt inschakelen?
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Annuleren"
            color="neutral"
            variant="outline"
            @click="confirmLowPolicyCancel"
          />
          <UButton
            label="Ja, verlaag het beleid"
            color="warning"
            @click="confirmLowPolicyYes"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
