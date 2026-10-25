import { parseScenarioJson } from './scenario-json.js'
import { InvalidScenarioPayload } from './expense-document.js'
export { parseScenarioJson } from './scenario-json.js'

export function createScenarioApi(fetcher = (...args) => fetch(...args)) {
  let authorization = '', generation = 0
  const pending = new Set(), cancelled = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' })
  const cancel = () => { generation++; pending.forEach(controller => controller.abort()); pending.clear() }
  return {
    login(username, password) { cancel(); authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}` },
    logout() { cancel(); authorization = '' },
    async request(path, options = {}) {
      const current = generation, controller = new AbortController(), abort = () => controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) controller.abort()
      pending.add(controller)
      try {
        if (controller.signal.aborted) throw cancelled()
        const response = await fetcher(`/api${path}`, { ...options, signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...options.headers, Authorization: authorization } })
        const raw = await response.text()
        if (current !== generation || controller.signal.aborted) throw cancelled()
        let data
        try { data = parseScenarioJson(raw) } catch (cause) { if (response.ok) throw cause; data = null }
        if (current !== generation || controller.signal.aborted) throw cancelled()
        if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || `Request failed (${response.status})`), { status: response.status })
        return data
      } finally { pending.delete(controller); options.signal?.removeEventListener('abort', abort) }
    },
  }
}
export { InvalidScenarioPayload }
