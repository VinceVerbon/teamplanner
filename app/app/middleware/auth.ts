export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  const { data } = await authClient.getSession()
  if (!data?.user) {
    // Preserve the intended destination (e.g. a parent-link confirm URL from a mail).
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
