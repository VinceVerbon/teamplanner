<script setup lang="ts">
// F26: instance-level (system) management - separate from club management. The instance
// is not the club: one instance can hold multiple clubs later.
definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { isInstanceAdmin } = useAdminCtx()

const { data: settings, refresh: refreshSettings } = await useFetch('/api/instance/settings')
const { data: admins, refresh: refreshAdmins, error: adminsError } = await useFetch('/api/instance/admins')

const dateFormats = [
  { label: '31-12-2026 (DD-MM-YYYY)', value: 'DD-MM-YYYY' },
  { label: '12/31/2026 (MM/DD/YYYY)', value: 'MM/DD/YYYY' },
  { label: '2026-12-31 (YYYY-MM-DD)', value: 'YYYY-MM-DD' }
]
const timeFormats = [
  { label: '19:30 (24-uurs)', value: '24h' },
  { label: '7:30 PM (12-uurs)', value: '12h' }
]
const weekNumberings = [
  { label: 'ISO 8601 (week begint op maandag)', value: 'iso' },
  { label: 'VS (week begint op zondag)', value: 'us' }
]

const form = reactive({ dateFormat: 'DD-MM-YYYY', timeFormat: '24h', weekNumbering: 'iso' })
watchEffect(() => {
  if (settings.value) {
    form.dateFormat = settings.value.dateFormat
    form.timeFormat = settings.value.timeFormat
    form.weekNumbering = settings.value.weekNumbering
  }
})

const savingSettings = ref(false)
async function saveSettings() {
  savingSettings.value = true
  try {
    await $fetch('/api/instance/settings', { method: 'PATCH', body: { ...form } })
    toast.add({ title: 'Systeeminstellingen opgeslagen' })
    await refreshSettings()
    await useFormats().load()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Opslaan is niet gelukt', color: 'error' })
  } finally {
    savingSettings.value = false
  }
}

const newAdminEmail = ref('')
const busyAdmins = ref(false)
async function grantAdmin() {
  busyAdmins.value = true
  try {
    await $fetch('/api/instance/admins', { method: 'POST', body: { email: newAdminEmail.value } })
    toast.add({ title: 'Systeembeheerder toegevoegd' })
    newAdminEmail.value = ''
    await refreshAdmins()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Toevoegen is niet gelukt', color: 'error' })
  } finally {
    busyAdmins.value = false
  }
}

async function revokeAdmin(id: string) {
  busyAdmins.value = true
  try {
    await $fetch(`/api/instance/admins/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Systeembeheerder verwijderd' })
    await refreshAdmins()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Verwijderen is niet gelukt', color: 'error' })
  } finally {
    busyAdmins.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="!isInstanceAdmin"
      color="warning"
      variant="subtle"
      title="Alleen systeembeheerders hebben toegang tot systeeminstellingen."
    />
    <template v-else>
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Systeeminstellingen
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Instellingen voor de hele installatie (alle clubs). Clubspecifieke
            instellingen staan onder Club, Thema en Gebruikers.
          </p>
          <UFormField label="Datumnotatie">
            <USelect
              v-model="form.dateFormat"
              :items="dateFormats"
              class="w-72"
            />
          </UFormField>
          <UFormField label="Tijdnotatie">
            <USelect
              v-model="form.timeFormat"
              :items="timeFormats"
              class="w-72"
            />
          </UFormField>
          <UFormField label="Weeknummering">
            <USelect
              v-model="form.weekNumbering"
              :items="weekNumberings"
              class="w-72"
            />
          </UFormField>
          <UButton
            label="Opslaan"
            :loading="savingSettings"
            @click="saveSettings"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Systeembeheerders
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Systeembeheerders beheren de installatie: instellingen, clubs en accounts.
            Clubbeheer staat hier los van en regel je per club.
          </p>
          <div class="flex gap-2">
            <UInput
              v-model="newAdminEmail"
              type="email"
              class="w-full"
              placeholder="e-mailadres van een bestaand account"
            />
            <UButton
              label="Toevoegen"
              :loading="busyAdmins"
              @click="grantAdmin"
            />
          </div>
          <UAlert
            v-if="adminsError"
            color="error"
            variant="subtle"
            title="Kon systeembeheerders niet laden."
          />
          <ul class="divide-y divide-default">
            <li
              v-for="a in admins || []"
              :key="a.id"
              class="flex items-center justify-between py-2"
            >
              <span>{{ a.name }} <span class="text-muted text-sm">{{ a.email }}</span></span>
              <UButton
                label="Verwijderen"
                size="xs"
                color="error"
                variant="outline"
                :disabled="busyAdmins || (admins || []).length <= 1"
                @click="revokeAdmin(a.id)"
              />
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </div>
</template>
