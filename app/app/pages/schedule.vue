<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data: schedule, refresh } = await useFetch('/api/me/schedule')
const toast = useToast()

const ROLE_LABELS: Record<string, string> = {
  player: 'speler',
  staff: 'staf',
  parent: 'ouder'
}
const CLASS_LABELS: Record<string, string> = {
  'timely': 'tijdig',
  'late': 'te laat',
  'no-show': 'niet gemeld'
}

const todayStr = new Date().toISOString().slice(0, 10)

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

// --- F13 report/withdraw ---
type Entry = NonNullable<typeof schedule.value>[number]
type Session = Entry['sessions'][number]

const reporting = ref<string | null>(null) // session id with the open form
const reportPlayer = ref('')
const reportReason = ref('')
const busy = ref(false)

function openReport(entry: Entry, session: Session) {
  reporting.value = reporting.value === session.id ? null : session.id
  const open = openReportTargets(entry, session)
  reportPlayer.value = open[0]?.userId ?? ''
  reportReason.value = ''
}

/** Manageable players who do not have an absence on this session yet. */
function openReportTargets(entry: Entry, session: Session) {
  const absent = new Set(session.absences.map(a => a.playerUserId))
  return entry.manageablePlayers.filter(p => !absent.has(p.userId))
}

/** Absences on this session belonging to players the user manages. */
function myAbsences(entry: Entry, session: Session) {
  const mine = new Set(entry.manageablePlayers.map(p => p.userId))
  return session.absences.filter(a => mine.has(a.playerUserId))
}

async function submitAbsence(session: Session) {
  if (!reportPlayer.value) return
  busy.value = true
  try {
    await $fetch(`/api/sessions/${session.id}/absences`, {
      method: 'POST',
      body: { playerUserId: reportPlayer.value, reason: reportReason.value || undefined }
    })
    toast.add({ title: 'Afgemeld' })
    reporting.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Afmelden is niet gelukt', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function withdraw(absenceId: string) {
  busy.value = true
  try {
    await $fetch(`/api/absences/${absenceId}`, { method: 'DELETE' })
    toast.add({ title: 'Afmelding ingetrokken' })
    await refresh()
  } catch (e) {
    toast.add({ title: (e as { statusMessage?: string }).statusMessage || 'Intrekken is niet gelukt', color: 'error' })
  } finally {
    busy.value = false
  }
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
        <div class="flex items-center justify-between">
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
          <UButton
            :to="`/admin/teams/${entry.team.id}`"
            label="Team & aanwezigheid"
            variant="ghost"
            color="neutral"
            size="xs"
          />
        </div>
      </template>

      <ul class="divide-y divide-default">
        <li
          v-for="s in entry.sessions"
          :key="s.id"
          class="py-2 space-y-1"
        >
          <div class="flex items-center justify-between gap-2">
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
              <UButton
                v-if="s.status === 'scheduled' && openReportTargets(entry, s).length"
                label="Afmelden"
                size="xs"
                color="neutral"
                variant="outline"
                @click="openReport(entry, s)"
              />
            </span>
          </div>

          <p
            v-if="s.absences.length"
            class="text-sm text-muted"
          >
            Afgemeld:
            <template
              v-for="(a, i) in s.absences"
              :key="a.id"
            >
              <template v-if="i > 0">
                ,
              </template>{{ a.playerName }} ({{ CLASS_LABELS[a.classification] }}<template v-if="a.reason">
                - {{ a.reason }}
              </template>)<UButton
                v-if="myAbsences(entry, s).some(m => m.id === a.id) && s.status === 'scheduled'"
                label="intrekken"
                size="xs"
                variant="link"
                :loading="busy"
                @click="withdraw(a.id)"
              />
            </template>
          </p>

          <div
            v-if="reporting === s.id"
            class="flex flex-wrap gap-2 items-center"
          >
            <USelect
              v-if="openReportTargets(entry, s).length > 1"
              v-model="reportPlayer"
              :items="openReportTargets(entry, s).map(p => ({ label: p.name, value: p.userId }))"
            />
            <UInput
              v-model="reportReason"
              class="flex-1 min-w-40"
              placeholder="Reden (optioneel)"
            />
            <UButton
              label="Bevestig afmelding"
              size="xs"
              :loading="busy"
              @click="submitAbsence(s)"
            />
          </div>
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
