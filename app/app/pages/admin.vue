<script setup lang="ts">
// F25: Beheer is organized into main categories; section pages render as children.
// The navigation bar placement is a theme setting (left default, top or right); the
// system category is instance-admin-only (F26).
definePageMeta({ middleware: 'auth' })

const me = useMe()
onMounted(refreshMe)
const { clubData } = useAdminCtx()

const placement = computed<'left' | 'top' | 'right'>(() =>
  (clubData.value?.club?.navPlacement as 'left' | 'top' | 'right') || 'left')

const nav = computed(() => {
  const items = [
    { label: 'Club', icon: 'i-lucide-shield', to: '/admin/club' },
    { label: 'Thema', icon: 'i-lucide-palette', to: '/admin/theme' },
    { label: 'Gebruikers', icon: 'i-lucide-users', to: '/admin/users' },
    { label: 'Teams', icon: 'i-lucide-users-round', to: '/admin/teams' },
    { label: 'Locaties', icon: 'i-lucide-map-pin', to: '/admin/locations' },
    { label: 'Schema', icon: 'i-lucide-calendar-cog', to: '/admin/schedule' }
  ]
  if (me.value?.roles.instanceAdmin) {
    items.push({ label: 'Systeem', icon: 'i-lucide-server-cog', to: '/admin/system' })
  }
  return items
})
</script>

<template>
  <UContainer class="max-w-5xl py-10">
    <template v-if="placement === 'top'">
      <div class="space-y-6">
        <h1 class="text-2xl font-bold">
          Beheer
        </h1>
        <UNavigationMenu
          orientation="horizontal"
          :items="nav"
        />
        <NuxtPage />
      </div>
    </template>
    <div
      v-else
      class="flex flex-col sm:flex-row gap-8"
    >
      <aside
        class="sm:w-48 shrink-0"
        :class="placement === 'right' ? 'order-1 sm:order-2' : 'order-1'"
      >
        <UNavigationMenu
          orientation="vertical"
          :items="nav"
          class="sm:sticky sm:top-20"
        />
      </aside>
      <div
        class="flex-1 min-w-0 space-y-6"
        :class="placement === 'right' ? 'order-2 sm:order-1' : 'order-2'"
      >
        <h1 class="text-2xl font-bold">
          Beheer
        </h1>
        <NuxtPage />
      </div>
    </div>
  </UContainer>
</template>
