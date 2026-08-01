<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data: schedule } = await useFetch('/api/me/schedule')

const ROLE_LABELS: Record<string, string> = {
  player: 'speler',
  staff: 'staf',
  parent: 'ouder'
}

const todayStr = new Date().toISOString().slice(0, 10)

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}
</script>

<template>
  <UContainer class="max-w-3xl py-16 space-y-6">
    <h1 class="text-2xl font-bold">
      Mijn schema
    </h1>

    <UAlert
      v-if="schedule && !schedule.length"
      color="neutral"
      variant="subtle"
      title="Nog geen team"
      description="Je bent nog niet aan een team gekoppeld. Een beheerder of teamstaf wijst je toe."
    />

    <UCard
      v-for="entry in schedule || []"
      :key="entry.team.id"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <h2 class="font-semibold">
            {{ entry.team.name }}
          </h2>
          <UBadge
            v-for="role in entry.myRoles"
            :key="role"
            color="neutral"
            variant="subtle"
            :label="ROLE_LABELS[role] || role"
          />
        </div>
      </template>

      <ul class="divide-y divide-default">
        <li
          v-for="s in entry.sessions"
          :key="s.id"
          class="flex items-center justify-between py-2"
        >
          <span :class="s.status === 'cancelled' ? 'line-through text-muted' : ''">
            <UBadge
              v-if="s.type === 'match'"
              color="primary"
              variant="subtle"
              :label="s.homeAway === 'home' ? 'wedstrijd thuis' : 'wedstrijd uit'"
            />
            {{ fmtDate(s.date) }} {{ s.startTime }}-{{ s.endTime }}
            <strong v-if="s.type === 'match'">{{ s.opponent }}</strong>
            <span class="text-muted text-sm">
              {{ s.locationName }}<template v-if="s.trainerName"> - {{ s.trainerName }}</template>
            </span>
          </span>
          <span class="flex items-center gap-2">
            <UBadge
              v-if="s.date === todayStr && s.status === 'scheduled'"
              color="primary"
              variant="subtle"
              label="vandaag"
            />
            <UBadge
              v-if="s.status === 'cancelled'"
              color="error"
              variant="subtle"
              :label="`afgelast: ${s.cancelReason}`"
            />
          </span>
        </li>
        <li
          v-if="!entry.sessions.length"
          class="py-2 text-muted text-sm"
        >
          Geen komende trainingen.
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
