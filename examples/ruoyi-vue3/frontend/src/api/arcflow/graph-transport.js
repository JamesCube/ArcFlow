// Host-injected native request client; never creates a second authentication flow.
export function createNativeGraphTransport({ request, getToken, parseJson }) {
  let generation = 0, disposed = false
  const pending = new Set()
  const aborted = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' })
  const cancel = () => { generation++; for (const controller of pending) controller.abort(); pending.clear() }
  function error(status, message) { return Object.assign(new Error(message || `Request failed (${status})`), { status }) }
  async function send(url, options = {}) {
    const token = getToken(), epoch = generation, controller = new AbortController()
    const current = () => !disposed && epoch === generation && token === getToken() && !controller.signal.aborted
    const check = () => { if (!current()) throw aborted() }
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) controller.abort()
    pending.add(controller)
    try {
      check()
      if (!token) throw error(401, 'Authentication required')
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
      // Native duplicate suppression must not swallow a durable keyed replay.
      if (headers['Idempotency-Key']) headers.repeatSubmit = false
      const result = await request({ url, method: options.method || 'GET', data: options.body,
        signal: controller.signal, headers,
        transformResponse: [(raw, _headers, status) => {
          check() // Do not parse or expose stale-session responses/errors.
          let envelope
          try { envelope = parseJson(raw) }
          catch (cause) { if (status >= 400) throw error(status); throw cause }
          if (status >= 400) throw error(status, envelope?.msg || envelope?.message || envelope?.error)
          if (typeof envelope?.code !== 'number') throw error(502, 'Invalid native response')
          if (envelope.code !== 200) throw error(envelope.code, envelope.msg || envelope.message)
          return envelope
        }],
      })
      check()
      if (!result || result.code !== 200 || !Object.hasOwn(result, 'data')) throw error(result?.code || 502, result?.msg || 'Invalid native response')
      return result.data
    } catch (cause) {
      check()
      if (cause?.name === 'CanceledError' || cause?.code === 'ERR_CANCELED') throw aborted()
      if (cause?.status) throw cause
      const status = cause?.response?.status
      throw status ? error(status, cause.response?.data?.msg || cause.message) : cause
    } finally { pending.delete(controller); options.signal?.removeEventListener('abort', abort) }
  }
  return {
    cancel,
    dispose() { disposed = true; cancel() },
    me: () => send('/arcflow/me'),
    request(path, options) {
      if (!/^\/graphs\/travel\/(?:capabilities|users|process|requests|workspace|draft|validate|preview|publish|requests\/[^/?#]+(?:\/tasks\/[^/?#]+\/decision)?)$/.test(path)) return Promise.reject(error(400, 'Unsupported native graph route'))
      return send(`/arcflow${path}`, options).then(value => {
        if (path === '/graphs/travel/capabilities' && typeof value?.permissions?.canDecide !== 'boolean') throw error(502, 'Invalid native decision permission')
        return value
      })
    },
  }
}
