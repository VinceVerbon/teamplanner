<script setup lang="ts">
import { dominantColorFromPixels } from '../../../shared/utils/dominant-color'
import { passwordStrength, STRENGTH_LABELS, type PasswordPolicy } from '../../../shared/utils/password-strength'

definePageMeta({ middleware: 'auth' })

const me = useMe()
const toast = useToast()

const { data: clubData, refresh: refreshClub } = await useFetch('/api/clubs/current')
const { data: teamsData, refresh: refreshTeams } = await useFetch('/api/teams', { query: { archived: '1' } })

const isAdmin = computed(() => {
  const clubId = clubData.value?.club?.id
  return !!clubId && !!me.value?.roles.adminOfClubIds.includes(clubId)
})

onMounted(refreshMe)

// club bootstrap
const newClub = reactive({ slug: '', name: '' })
const creating = ref(false)
async function createClub() {
  creating.value = true
  try {
    await $fetch('/api/clubs', { method: 'POST', body: { ...newClub } })
    toast.add({ title: 'Club aangemaakt' })
    await Promise.all([refreshClub(), refreshMe()])
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Aanmaken is niet gelukt', color: 'error' })
  } finally {
    creating.value = false
  }
}

// club settings
const clubName = ref('')
watchEffect(() => {
  if (clubData.value?.club) clubName.value = clubData.value.club.name
})
const savingClub = ref(false)
async function saveClub() {
  if (!clubData.value?.club) return
  savingClub.value = true
  try {
    await $fetch(`/api/clubs/${clubData.value.club.id}`, { method: 'PATCH', body: { name: clubName.value } })
    toast.add({ title: 'Opgeslagen' })
    await refreshClub()
  } catch {
    toast.add({ title: 'Opslaan is niet gelukt', color: 'error' })
  } finally {
    savingClub.value = false
  }
}

// teams
const newTeamName = ref('')
const creatingTeam = ref(false)
async function createTeam() {
  creatingTeam.value = true
  try {
    await $fetch('/api/teams', { method: 'POST', body: { name: newTeamName.value } })
    newTeamName.value = ''
    await refreshTeams()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Aanmaken is niet gelukt', color: 'error' })
  } finally {
    creatingTeam.value = false
  }
}

async function setArchived(teamId: string, archived: boolean) {
  await $fetch(`/api/teams/${teamId}`, { method: 'PATCH', body: { archived } })
  await refreshTeams()
}

// F10: locations, seasons, club-level closures
const { data: locations, refresh: refreshLocations } = await useFetch('/api/locations')
const { data: seasons, refresh: refreshSeasons } = await useFetch('/api/seasons')
const { data: periods, refresh: refreshPeriods } = await useFetch('/api/no-training-periods')
const clubPeriods = computed(() => (periods.value || []).filter(p => !p.teamId))

const newLocation = reactive({ name: '', address: '' })
const newSeason = reactive({ name: '', startDate: '', endDate: '' })
const newClosure = reactive({ startDate: '', endDate: '', reason: '' })
const busyF10 = ref(false)

async function act(fn: () => Promise<unknown>, okMsg: string, refreshFn: () => Promise<void>) {
  busyF10.value = true
  try {
    await fn()
    toast.add({ title: okMsg })
    await refreshFn()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    busyF10.value = false
  }
}

const addLocation = () => act(async () => {
  await $fetch('/api/locations', { method: 'POST', body: { ...newLocation } })
  Object.assign(newLocation, { name: '', address: '' })
}, 'Locatie toegevoegd', refreshLocations)

const removeLocation = (id: string) => act(() =>
  $fetch(`/api/locations/${id}`, { method: 'DELETE' }), 'Locatie verwijderd', refreshLocations)

const addSeason = () => act(async () => {
  await $fetch('/api/seasons', { method: 'POST', body: { ...newSeason } })
  Object.assign(newSeason, { name: '', startDate: '', endDate: '' })
}, 'Seizoen toegevoegd', refreshSeasons)

const addClosure = () => act(async () => {
  await $fetch('/api/no-training-periods', { method: 'POST', body: { ...newClosure } })
  Object.assign(newClosure, { startDate: '', endDate: '', reason: '' })
}, 'Sluitingsperiode ingesteld (trainingen in de periode zijn afgelast)', refreshPeriods)

const removeClosure = (id: string) => act(() =>
  $fetch(`/api/no-training-periods/${id}`, { method: 'DELETE' }), 'Sluitingsperiode verwijderd', refreshPeriods)

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL')
}

// F20 branding: logo upload (color derived client-side as default) + primary color
const brandColor = ref('')
watchEffect(() => {
  if (clubData.value?.club?.primaryColor) brandColor.value = clubData.value.club.primaryColor
})
const logoBusy = ref(false)
const logoVersion = ref(0) // cache-buster after upload

async function deriveColor(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 64, resizeHeight: 64 })
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, 64, 64)
    return dominantColorFromPixels(ctx.getImageData(0, 0, 64, 64).data)
  } catch {
    return null // e.g. SVG without intrinsic size - color stays manual
  }
}

async function onLogoFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  const clubId = clubData.value?.club?.id
  if (!file || !clubId) return
  logoBusy.value = true
  try {
    const form = new FormData()
    form.append('logo', file)
    await $fetch(`/api/clubs/${clubId}/logo`, { method: 'POST', body: form })
    const derived = await deriveColor(file)
    if (derived && !clubData.value?.club?.primaryColor) {
      await $fetch(`/api/clubs/${clubId}/branding`, { method: 'PATCH', body: { primaryColor: derived } })
      toast.add({ title: `Logo opgeslagen - themakleur afgeleid: ${derived}` })
    } else {
      toast.add({ title: 'Logo opgeslagen' })
    }
    logoVersion.value++
    await refreshClub()
  } catch (err) {
    toast.add({ title: (err as { statusMessage?: string }).statusMessage || 'Upload is niet gelukt', color: 'error' })
  } finally {
    logoBusy.value = false
  }
}

async function saveBrandColor() {
  const clubId = clubData.value?.club?.id
  if (!clubId) return
  try {
    await $fetch(`/api/clubs/${clubId}/branding`, {
      method: 'PATCH',
      body: { primaryColor: brandColor.value || null }
    })
    toast.add({ title: 'Themakleur opgeslagen' })
    await refreshClub()
  } catch (err) {
    toast.add({ title: (err as { statusMessage?: string }).statusMessage || 'Opslaan is niet gelukt', color: 'error' })
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

// F23: admin creates an account directly (no self-registration, no verification mail).
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
</script>

<template>
  <UContainer class="max-w-3xl py-16 space-y-6">
    <h1 class="text-2xl font-bold">
      Beheer
    </h1>

    <UCard v-if="!clubData?.club">
      <template #header>
        <h2 class="font-semibold">
          Club aanmaken
        </h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Er is nog geen club. Maak de club aan; jij wordt automatisch beheerder.
        </p>
        <UFormField label="Naam">
          <UInput
            v-model="newClub.name"
            class="w-full"
            placeholder="FC Aalsmeer"
          />
        </UFormField>
        <UFormField
          label="Slug"
          hint="korte naam voor in de URL, bijv. fcaalsmeer"
        >
          <UInput
            v-model="newClub.slug"
            class="w-full"
            placeholder="fcaalsmeer"
          />
        </UFormField>
        <UButton
          label="Club aanmaken"
          :loading="creating"
          @click="createClub"
        />
      </div>
    </UCard>

    <template v-else>
      <UAlert
        v-if="!isAdmin"
        color="warning"
        variant="subtle"
        title="Alleen beheerders kunnen hier wijzigingen doen."
      />

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Club
          </h2>
        </template>
        <div class="space-y-4">
          <UFormField label="Naam">
            <div class="flex gap-2">
              <UInput
                v-model="clubName"
                class="w-full"
                :disabled="!isAdmin"
              />
              <UButton
                label="Opslaan"
                :loading="savingClub"
                :disabled="!isAdmin"
                @click="saveClub"
              />
            </div>
          </UFormField>
          <UFormField
            label="Clublogo"
            hint="PNG/JPEG/SVG/WebP, max 1 MB - de themakleur wordt als standaard uit het logo afgeleid"
          >
            <div class="flex items-center gap-3">
              <img
                v-if="clubData?.club?.hasLogo"
                :key="logoVersion"
                :src="`/api/clubs/${clubData.club.id}/logo?v=${logoVersion}`"
                alt="clublogo"
                class="h-10 w-10 object-contain"
              >
              <input
                v-if="isAdmin"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                class="text-sm"
                :disabled="logoBusy"
                @change="onLogoFile"
              >
            </div>
          </UFormField>
          <UFormField
            label="Themakleur"
            hint="wordt overal in de app als primaire kleur gebruikt"
          >
            <div class="flex items-center gap-2">
              <input
                v-model="brandColor"
                type="color"
                :disabled="!isAdmin"
                class="h-8 w-12 cursor-pointer rounded border border-default bg-transparent"
              >
              <UInput
                v-model="brandColor"
                class="w-28"
                :disabled="!isAdmin"
                placeholder="#1a7f37"
              />
              <UButton
                label="Opslaan"
                :disabled="!isAdmin"
                @click="saveBrandColor"
              />
            </div>
          </UFormField>
          <UFormField
            label="Wachtwoordbeleid"
            hint="minimale sterkte voor alle nieuwe wachtwoorden; standaard is 'Middel'"
          >
            <USelect
              v-model="passwordPolicy"
              :items="policyItems"
              :disabled="!isAdmin"
              class="w-64"
              @update:model-value="onPolicyChange"
            />
          </UFormField>
        </div>
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

      <UCard v-if="isAdmin">
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

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Teams
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newTeamName"
              class="w-full"
              placeholder="Nieuw team, bijv. MO17-4"
            />
            <UButton
              label="Toevoegen"
              :loading="creatingTeam"
              @click="createTeam"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="team in teamsData?.teams || []"
              :key="team.id"
              class="flex items-center justify-between py-2"
            >
              <NuxtLink
                :to="`/admin/teams/${team.id}`"
                class="text-primary"
              >
                {{ team.name }}
                <UBadge
                  v-if="team.archived"
                  color="neutral"
                  variant="subtle"
                  label="gearchiveerd"
                />
              </NuxtLink>
              <UButton
                v-if="isAdmin"
                :label="team.archived ? 'Herstellen' : 'Archiveren'"
                size="xs"
                color="neutral"
                variant="outline"
                @click="setArchived(team.id, !team.archived)"
              />
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Locaties
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newLocation.name"
              class="w-full"
              placeholder="Naam, bijv. Sporthal De Bloemhof"
            />
            <UInput
              v-model="newLocation.address"
              class="w-full"
              placeholder="Adres (optioneel)"
            />
            <UButton
              label="Toevoegen"
              :loading="busyF10"
              @click="addLocation"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="loc in locations || []"
              :key="loc.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ loc.name }} <span class="text-muted text-sm">{{ loc.address }}</span></span>
              <UButton
                v-if="isAdmin"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removeLocation(loc.id)"
              />
            </li>
            <li
              v-if="!locations?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen locaties.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Seizoenen
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newSeason.name"
              class="w-full"
              placeholder="Naam, bijv. 2026-2027"
            />
            <UInput
              v-model="newSeason.startDate"
              type="date"
            />
            <UInput
              v-model="newSeason.endDate"
              type="date"
            />
            <UButton
              label="Toevoegen"
              :loading="busyF10"
              @click="addSeason"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="s in seasons || []"
              :key="s.id"
              class="py-2"
            >
              {{ s.name }} <span class="text-muted text-sm">{{ fmtDate(s.startDate) }} t/m {{ fmtDate(s.endDate) }}</span>
            </li>
            <li
              v-if="!seasons?.length"
              class="py-2 text-muted text-sm"
            >
              Nog geen seizoenen.
            </li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Sluitingsperiodes (hele club)
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            In deze periodes traint geen enkel team. Bestaande trainingen in de periode worden afgelast; teams kunnen deze grenzen niet omzeilen.
          </p>
          <div
            v-if="isAdmin"
            class="flex gap-2"
          >
            <UInput
              v-model="newClosure.startDate"
              type="date"
            />
            <UInput
              v-model="newClosure.endDate"
              type="date"
            />
            <UInput
              v-model="newClosure.reason"
              class="w-full"
              placeholder="Reden, bijv. winterstop"
            />
            <UButton
              label="Instellen"
              :loading="busyF10"
              @click="addClosure"
            />
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="p in clubPeriods"
              :key="p.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ fmtDate(p.startDate) }} t/m {{ fmtDate(p.endDate) }} <span class="text-muted text-sm">{{ p.reason }}</span></span>
              <UButton
                v-if="isAdmin"
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                @click="removeClosure(p.id)"
              />
            </li>
            <li
              v-if="!clubPeriods.length"
              class="py-2 text-muted text-sm"
            >
              Geen sluitingsperiodes.
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </UContainer>
</template>
