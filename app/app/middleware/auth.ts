export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  const { data } = await authClient.getSession()
  if (!data?.user) {
    return navigateTo('/login')
  }
})
