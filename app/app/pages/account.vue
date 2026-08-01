<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface ParentLink {
  id: string
  status: 'pending' | 'active'
  myRole: 'parent' | 'player'
  requestedByMe: boolean
  other: { id: string, name: string, email: string }
  player: {
    dateOfBirth: string | null
    selfManageOptIn: boolean
    parentManageOptIn: boolean
    parentMayManage: boolean
  }
}

const { data: me, refresh } = await useFetch('/api/me')
const { data: links, refresh: refreshLinks } = await useFetch<ParentLink[]>('/api/parent-links')

const editName = ref('')
const editDob = ref('')
const saving = ref(false)
const toast = useToast()

watchEffect(() => {
  if (me.value?.user) editName.value = me.value.user.name
  if (me.value?.settings.dateOfBirth) editDob.value = me.value.settings.dateOfBirth
})

async function saveProfile() {
  saving.value = true
  const { error } = await authClient.updateUser({
    name: editName.value,
    ...(editDob.value ? { dateOfBirth: new Date(editDob.value) } : {})
  } as never)
  saving.value = false
  if (error) {
    toast.add({ title: 'Opslaan is niet gelukt', color: 'error' })
    return
  }
  toast.add({ title: 'Opgeslagen' })
  await refresh()
}

// --- Parent-player linking (F5) ---

const linkEmail = ref('')
const linkRelation = ref<'parent' | 'player'>('parent')
const linkPending = ref(false)
const relationOptions = [
  { value: 'parent', label: 'Dit is mijn ouder/verzorger' },
  { value: 'player', label: 'Dit is mijn kind (speler)' }
]

async function requestLink() {
  if (!linkEmail.value) return
  linkPending.value = true
  try {
    await $fetch('/api/parent-links', {
      method: 'POST',
      body: { email: linkEmail.value, otherRole: linkRelation.value }
    })
    toast.add({ title: 'Verzoek verstuurd', description: 'De ander ontvangt een mail om de koppeling te bevestigen.' })
    linkEmail.value = ''
    await refreshLinks()
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode
    toast.add({
      title: status === 404
        ? 'Geen account met dit e-mailadres gevonden'
        : status === 409
          ? 'Deze koppeling bestaat al'
          : 'Verzoek is niet gelukt',
      color: 'error'
    })
  } finally {
    linkPending.value = false
  }
}

async function removeLink(id: string) {
  await $fetch(`/api/parent-links/${id}`, { method: 'DELETE' })
  toast.add({ title: 'Koppeling verwijderd' })
  await refreshLinks()
}

function ageOf(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  if (now.getMonth() < dob.getMonth()
    || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--
  return age
}

const myAge = computed(() => ageOf(me.value?.settings.dateOfBirth ?? null))
const activeParentLinksAsPlayer = computed(() =>
  (links.value ?? []).filter(l => l.myRole === 'player' && l.status === 'active'))

// 18+ player with an active parent link: "mijn ouder mag mijn aanwezigheid beheren".
const showParentManageToggle = computed(() =>
  myAge.value !== null && myAge.value >= 18 && activeParentLinksAsPlayer.value.length > 0)

async function setParentManageOptIn(enabled: boolean) {
  await $fetch('/api/me/attendance-settings', { method: 'PATCH', body: { parentManageOptIn: enabled } })
  toast.add({ title: 'Instelling opgeslagen' })
  await refresh()
}

// Under-15 checkmark, set by the parent per child.
function showSelfManageToggle(link: ParentLink): boolean {
  if (link.myRole !== 'parent' || link.status !== 'active') return false
  const age = ageOf(link.player.dateOfBirth)
  return age !== null && age < 15
}

async function setSelfManageOptIn(link: ParentLink, enabled: boolean) {
  await $fetch(`/api/users/${link.other.id}/attendance-settings`, {
    method: 'PATCH',
    body: { selfManageOptIn: enabled }
  })
  toast.add({ title: 'Instelling opgeslagen' })
  await refreshLinks()
}
</script>

<template>
  <UContainer class="max-w-2xl py-16 space-y-6">
    <h1 class="text-2xl font-bold">
      Mijn account
    </h1>

    <UCard v-if="me">
      <template #header>
        <h2 class="font-semibold">
          Profiel
        </h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Naam">
          <UInput
            v-model="editName"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Geboortedatum"
          hint="verplicht voor spelers"
        >
          <UInput
            v-model="editDob"
            type="date"
            class="w-full"
          />
        </UFormField>
        <UFormField label="E-mailadres">
          <p>
            {{ me.user.email }} <UBadge
              v-if="me.user.emailVerified"
              color="success"
              variant="subtle"
              label="geverifieerd"
            />
          </p>
        </UFormField>
        <UButton
          label="Opslaan"
          :loading="saving"
          @click="saveProfile"
        />
      </div>
    </UCard>

    <UCard v-if="me">
      <template #header>
        <h2 class="font-semibold">
          Ouder-speler koppelingen
        </h2>
      </template>

      <div class="space-y-4">
        <ul
          v-if="links?.length"
          class="space-y-3"
        >
          <li
            v-for="link in links"
            :key="link.id"
            class="flex flex-col gap-2 border border-default rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="font-medium">
                  {{ link.other.name }}
                  <span class="text-muted text-sm">({{ link.other.email }})</span>
                </p>
                <p class="text-sm text-muted">
                  {{ link.myRole === 'parent' ? 'Mijn kind (speler)' : 'Mijn ouder/verzorger' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  :color="link.status === 'active' ? 'success' : 'warning'"
                  variant="subtle"
                  :label="link.status === 'active' ? 'actief' : 'wacht op bevestiging'"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="removeLink(link.id)"
                />
              </div>
            </div>
            <p
              v-if="link.status === 'pending' && !link.requestedByMe"
              class="text-sm text-muted"
            >
              Bevestig deze koppeling via de link in je mail.
            </p>
            <USwitch
              v-if="showSelfManageToggle(link)"
              :model-value="link.player.selfManageOptIn"
              label="Mag zelf aanwezigheid beheren (jonger dan 15)"
              @update:model-value="setSelfManageOptIn(link, $event as boolean)"
            />
            <p
              v-if="link.myRole === 'parent' && link.status === 'active' && !link.player.parentMayManage"
              class="text-sm text-muted"
            >
              Deze speler is 18+ en beheert de eigen aanwezigheid.
            </p>
          </li>
        </ul>
        <p
          v-else
          class="text-sm text-muted"
        >
          Nog geen koppelingen.
        </p>

        <USeparator />

        <div class="space-y-3">
          <UFormField label="Koppel een ouder of kind (via e-mailadres van een bestaand account)">
            <UInput
              v-model="linkEmail"
              type="email"
              placeholder="naam@voorbeeld.nl"
              class="w-full"
            />
          </UFormField>
          <URadioGroup
            v-model="linkRelation"
            :items="relationOptions"
          />
          <UButton
            label="Verstuur koppelverzoek"
            :loading="linkPending"
            :disabled="!linkEmail"
            @click="requestLink"
          />
        </div>

        <template v-if="showParentManageToggle">
          <USeparator />
          <USwitch
            :model-value="me.settings.parentManageOptIn"
            label="Mijn ouder mag mijn aanwezigheid beheren"
            @update:model-value="setParentManageOptIn($event as boolean)"
          />
        </template>
      </div>
    </UCard>

    <UCard v-if="me">
      <template #header>
        <h2 class="font-semibold">
          Mijn rollen
        </h2>
      </template>
      <ul class="space-y-1 text-sm">
        <li v-if="me.roles.adminOfClubIds.length">
          Beheerder van de club
        </li>
        <li v-if="me.roles.playerTeamId">
          Speler
        </li>
        <li v-if="me.roles.staffTeamIds.length">
          Staflid van {{ me.roles.staffTeamIds.length }} team(s)
        </li>
        <li
          v-if="me.roles.pendingStaffTeamIds.length"
          class="text-muted"
        >
          Staf-aanmelding wacht op goedkeuring van de beheerder
        </li>
        <li v-if="me.roles.parentOfUserIds.length">
          Ouder van {{ me.roles.parentOfUserIds.length }} speler(s)
        </li>
        <li
          v-if="!me.roles.adminOfClubIds.length && !me.roles.playerTeamId && !me.roles.staffTeamIds.length && !me.roles.parentOfUserIds.length"
          class="text-muted"
        >
          Nog geen rollen - een beheerder of teamstaf wijst je toe aan een team.
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
