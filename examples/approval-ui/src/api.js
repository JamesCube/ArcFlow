// Credentials live only in this closure. No localStorage, cookie, or URL persistence.
export function createApi(fetcher = (...args) => fetch(...args)) {
  let authorization = ''
  return {
    login(username, password) { authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}` },
    logout() { authorization = '' },
    async request(path, options = {}) {
      const response = await fetcher(`/api${path}`, {
        ...options, credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...options.headers, Authorization: authorization },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const error = new Error(data?.message || data?.error || `Request failed (${response.status})`)
        error.status = response.status
        throw error
      }
      return data
    },
  }
}
export const api = createApi()
