<script setup lang="ts">
import { dominantColorFromPixels } from '../../../shared/utils/dominant-color'

definePageMeta({ middleware: 'auth' })

const toast = useToast()
const { clubData, refreshClub, isAdmin } = useAdminCtx()

// F20 branding: logo upload (color derived client-side as default) + primary color.
const brandColor = ref('')
watchEffect(() => {
  if (clubData.value?.club?.primaryColor) brandColor.value = clubData.value.club.primaryColor
})
const logoBusy = ref(false)
const logoVersion = ref(0) // cache-buster after upload
const fileInput = ref<HTMLInputElement | null>(null)

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
    if (fileInput.value) fileInput.value.value = ''
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
            Thema
          </h2>
        </template>
        <div class="space-y-4">
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
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                class="hidden"
                @change="onLogoFile"
              >
              <UButton
                v-if="isAdmin"
                :label="clubData?.club?.hasLogo ? 'Ander logo kiezen...' : 'Logo kiezen...'"
                icon="i-lucide-upload"
                color="neutral"
                variant="outline"
                :loading="logoBusy"
                @click="fileInput?.click()"
              />
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
        </div>
      </UCard>
    </template>
  </div>
</template>
