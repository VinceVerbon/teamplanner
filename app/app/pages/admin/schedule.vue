<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, isAdmin } = useAdminCtx()
const { load: loadFormats, fmtDate } = useFormats()
onMounted(loadFormats)

const { data: seasons, refresh: refreshSeasons } = await useFetch('/api/seasons')
const { data: periods, refresh: refreshPeriods } = await useFetch('/api/no-training-periods')
const clubPeriods = computed(() => (periods.value || []).filter(p => !p.teamId))

const newSeason = reactive({ name: '', startDate: '', endDate: '' })
const newClosure = reactive({ startDate: '', endDate: '', reason: '' })
const busy = ref(false)

async function act(fn: () => Promise<unknown>, okMsg: string, refreshFn: () => Promise<void>) {
  busy.value = true
  try {
    await fn()
    toast.add({ title: okMsg })
    await refreshFn()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Actie is niet gelukt', color: 'error' })
  } finally {
    busy.value = false
  }
}

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

// F28: central changelog of processed speeldagenkalender changes - visible to all
// clubs and staff by design.
interface KalenderChangeRow {
  id: string
  season: string
  region: string
  kind: string
  description: string
  changedAt: string
}
const { data: kalenderChanges } = await useFetch<KalenderChangeRow[]>('/api/speeldagen-changes')
function fmtStamp(ts: string): string {
  return new Date(ts).toLocaleString('nl-NL')
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="!clubData?.club"
      color="warning"
      variant="subtle"
      title="Maak eerst de club aan (Club)."
    />
    <template v-else>
      <UAlert
        v-if="!isAdmin"
        color="warning"
        variant="subtle"
        title="Alleen clubbeheerders kunnen hier wijzigingen doen."
      />
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
              :loading="busy"
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
              :loading="busy"
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

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            KNVB speeldagenkalender - wijzigingenlogboek
          </h2>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Centraal logboek van verwerkte wijzigingen in de KNVB speeldagenkalenders,
            zichtbaar voor alle clubs en stafleden.
          </p>
          <ul class="divide-y divide-default text-sm max-h-96 overflow-y-auto">
            <li
              v-for="c in kalenderChanges || []"
              :key="c.id"
              class="py-2"
            >
              <span class="text-muted">{{ fmtStamp(c.changedAt) }} - {{ c.region }} {{ c.season }}:</span>
              {{ c.description }}
            </li>
            <li
              v-if="!kalenderChanges?.length"
              class="py-2 text-muted"
            >
              Nog geen verwerkte wijzigingen.
            </li>
          </ul>
        </div>
      </UCard>
    </template>
  </div>
</template>
