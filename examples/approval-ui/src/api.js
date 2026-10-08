import { parseApprovalJson } from './business-document.js'

// Credentials live only in this closure. No localStorage, cookie, or URL persistence.
export function createApi(fetcher = (...args) => fetch(...args)) {
  let authorization = '', generation = 0
  const pending = new Set()
  const cancel = () => { generation++; pending.forEach(controller => controller.abort()); pending.clear() }
  const abortError = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' })
  return {
    login(username, password) { cancel(); authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}` },
    logout() { cancel(); authorization = '' },
    async request(path, options = {}) {
      const current = generation, controller = new AbortController()
      const abort = () => controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) controller.abort()
      pending.add(controller)
      try {
        if (controller.signal.aborted) throw abortError()
        const response = await fetcher(`/api${path}`, {
          ...options, signal: controller.signal, credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...options.headers, Authorization: authorization },
        })
        const raw = await response.text()
        // Check the session before parsing a late body or exposing its errors.
        if (current !== generation || controller.signal.aborted) throw abortError()
        let data
        try { data = /^\/(?:requests|documents)(?:\/|\?|$)/.test(path) ? parseApprovalJson(raw) : JSON.parse(raw) }
        catch (cause) { if (response.ok) throw cause; data = null }
        if (current !== generation || controller.signal.aborted) throw abortError()
        if (!response.ok) {
          const error = new Error(data?.message || data?.error || `Request failed (${response.status})`)
          error.status = response.status
          throw error
        }
        return data
      } finally { pending.delete(controller); options.signal?.removeEventListener('abort', abort) }
    },
  }
}
export const api = createApi()
