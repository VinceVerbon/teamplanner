<script setup lang="ts">
// F25: Beheer is organized into main categories with a navigation bar on the RIGHT;
// section pages render as children. The system category is instance-admin-only (F26).
definePageMeta({ middleware: 'auth' })

const me = useMe()
onMounted(refreshMe)

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
    <div class="flex flex-col sm:flex-row gap-8">
      <div class="flex-1 min-w-0 space-y-6 order-2 sm:order-1">
        <h1 class="text-2xl font-bold">
          Beheer
        </h1>
        <NuxtPage />
      </div>
      <aside class="sm:w-48 shrink-0 order-1 sm:order-2">
        <UNavigationMenu
          orientation="vertical"
          :items="nav"
          class="sm:sticky sm:top-20"
        />
      </aside>
    </div>
  </UContainer>
</template>
