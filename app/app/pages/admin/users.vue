<script setup lang="ts">
import {
  passwordStrength, STRENGTH_LABELS, customWeakerThanMedium,
  type PasswordPolicySetting, type CustomPasswordRules
} from '../../../shared/utils/password-strength'

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
// 'Aangepast' defines explicit rules (min length + required character elements).
const policyItems = [
  { label: 'Laag', value: 'low' },
  { label: 'Middel (standaard)', value: 'medium' },
  { label: 'Sterk', value: 'strong' },
  { label: 'Aangepast', value: 'custom' }
]

const POLICY_DESCRIPTIONS: Record<PasswordPolicySetting, string> = {
  low: 'Geen extra eisen: alleen minimaal 8 tekens. Veelgebruikte wachtwoorden blijven '
    + 'altijd geblokkeerd. Dit is lager dan de standaard.',
  medium: 'De standaard. Minimaal 8 tekens EN voldoende sterkte: kortere wachtwoorden '
    + 'hebben meerdere tekensoorten nodig (hoofdletters, cijfers of leestekens); vanaf '
    + '12 tekens volstaat minder variatie. Veelgebruikte wachtwoorden geblokkeerd.',
  strong: 'Hogere eis: sterkte \'sterk\'. In de praktijk: 12+ tekens gecombineerd met '
    + 'meerdere tekensoorten, of een lange wachtwoordzin (16+ tekens). Veelgebruikte '
    + 'wachtwoorden geblokkeerd.',
  custom: 'Eigen regels: stel de minimale lengte in en welke tekensoorten verplicht '
    + 'zijn. Veelgebruikte wachtwoorden blijven altijd geblokkeerd.'
}

const storedPolicy = computed<PasswordPolicySetting>(() =>
  (clubData.value?.club?.passwordPolicy as PasswordPolicySetting) || 'medium')
const passwordPolicy = ref<PasswordPolicySetting>('medium')
watchEffect(() => {
  passwordPolicy.value = storedPolicy.value
})
const policyDescription = computed(() => POLICY_DESCRIPTIONS[passwordPolicy.value])

const customRules = reactive<CustomPasswordRules>({
  minLength: 8, requireLowercase: false, requireUppercase: false, requireDigit: false, requireSymbol: false
})
watchEffect(() => {
  const c = clubData.value?.club
  if (!c) return
  customRules.minLength = c.passwordCustomMinLength ?? 8
  customRules.requireLowercase = !!c.passwordCustomRequireLowercase
  customRules.requireUppercase = !!c.passwordCustomRequireUppercase
  customRules.requireDigit = !!c.passwordCustomRequireDigit
  customRules.requireSymbol = !!c.passwordCustomRequireSymbol
})

const confirmWeakPolicy = ref(false)
let pendingSave: { policy: PasswordPolicySetting, custom?: CustomPasswordRules } | null = null

async function persistPolicy(policy: PasswordPolicySetting, custom?: CustomPasswordRules) {
  const clubId = clubData.value?.club?.id
  if (!clubId) return
  try {
    await $fetch(`/api/clubs/${clubId}/password-policy`, {
      method: 'PATCH',
      body: { policy, ...(custom ? { custom: { ...custom } } : {}) }
    })
    toast.add({ title: 'Wachtwoordbeleid opgeslagen' })
    await refreshClub()
  } catch (err) {
    toast.add({ title: (err as { statusMessage?: string }).statusMessage || 'Opslaan is niet gelukt', color: 'error' })
    passwordPolicy.value = storedPolicy.value
  }
}

async function onPolicyChange(value: unknown) {
  const policy = value as PasswordPolicySetting
  if (policy === 'custom') return // saved explicitly via the rules form
  if (policy === storedPolicy.value) return
  if (policy === 'low') {
    // Are-you-sure gate before a weaker-than-standard policy activates.
    pendingSave = { policy }
    confirmWeakPolicy.value = true
    return
  }
  await persistPolicy(policy)
}

async function saveCustomRules() {
  if (customWeakerThanMedium({ ...customRules })) {
    pendingSave = { policy: 'custom', custom: { ...customRules } }
    confirmWeakPolicy.value = true
    return
  }
  await persistPolicy('custom', { ...customRules })
}

async function confirmWeakYes() {
  confirmWeakPolicy.value = false
  if (pendingSave) await persistPolicy(pendingSave.policy, pendingSave.custom)
  pendingSave = null
}

function confirmWeakCancel() {
  confirmWeakPolicy.value = false
  pendingSave = null
  passwordPolicy.value = storedPolicy.value
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
      <div class="flex flex-col sm:flex-row gap-6">
        <div class="sm:w-72 shrink-0 space-y-4">
          <UFormField
            label="Beleid"
            hint="geldt voor alle nieuwe wachtwoorden"
          >
            <USelect
              v-model="passwordPolicy"
              :items="policyItems"
              :disabled="!isAdmin"
              class="w-full"
              @update:model-value="onPolicyChange"
            />
          </UFormField>
          <template v-if="passwordPolicy === 'custom'">
            <UFormField label="Minimale lengte">
              <UInput
                v-model.number="customRules.minLength"
                type="number"
                min="8"
                max="128"
                class="w-24"
                :disabled="!isAdmin"
              />
            </UFormField>
            <UFormField label="Verplichte onderdelen">
              <div class="space-y-2">
                <UCheckbox
                  v-model="customRules.requireLowercase"
                  label="kleine letter"
                  :disabled="!isAdmin"
                />
                <UCheckbox
                  v-model="customRules.requireUppercase"
                  label="hoofdletter"
                  :disabled="!isAdmin"
                />
                <UCheckbox
                  v-model="customRules.requireDigit"
                  label="cijfer"
                  :disabled="!isAdmin"
                />
                <UCheckbox
                  v-model="customRules.requireSymbol"
                  label="leesteken"
                  :disabled="!isAdmin"
                />
              </div>
            </UFormField>
            <UButton
              label="Regels opslaan"
              :disabled="!isAdmin"
              @click="saveCustomRules"
            />
          </template>
        </div>
        <div class="flex-1 text-sm text-muted border-l border-default pl-6">
          <p class="font-medium text-highlighted mb-1">
            {{ policyItems.find(i => i.value === passwordPolicy)?.label }}
          </p>
          <p>{{ policyDescription }}</p>
          <p
            v-if="passwordPolicy !== storedPolicy && passwordPolicy === 'custom'"
            class="mt-2 text-warning"
          >
            Nog niet actief - sla de regels op om dit beleid in te schakelen.
          </p>
        </div>
      </div>
    </UCard>

    <UModal
      v-model:open="confirmWeakPolicy"
      title="Weet je het zeker?"
    >
      <template #body>
        <p class="text-sm">
          Dit beleid is zwakker dan de standaard ('Middel'). Zwakke wachtwoorden maken
          accounts kwetsbaarder. Weet je zeker dat je dit wilt inschakelen?
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Annuleren"
            color="neutral"
            variant="outline"
            @click="confirmWeakCancel"
          />
          <UButton
            label="Ja, gebruik dit beleid"
            color="warning"
            @click="confirmWeakYes"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
