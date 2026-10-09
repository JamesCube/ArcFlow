import { CURRENCIES, InvalidScenarioPayload, invalid, isRecord } from './expense-document.js'
const MONEY_FIELDS = new Set(['amount', 'estimatedCost', 'contractAmount', 'invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount'])
const ZERO_MONEY_FIELDS = new Set(['previouslySettledAmount', 'deductionAmount'])
class NumberToken { constructor(source) { this.source = source } }
// Preserve numeric lexemes before native parsing can hide sub-cent fractions.
export function parseScenarioJson(source) {
  if (typeof source !== 'string' || source.length > 8000000) return invalid()
  let position = 0
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[position] || '!')) position++ }
  function string() {
    const start = position++
    while (position < source.length) {
      const character = source[position++]
      if (character === '\\') position++
      else if (character === '"') { try { return JSON.parse(source.slice(start, position)) } catch { return invalid() } }
    }
    return invalid()
  }
  function value(depth) {
    if (depth > 64) return invalid()
    whitespace(); const character = source[position]
    if (character === '"') return string()
    if (character === '{') {
      position++; whitespace(); const result = Object.create(null)
      if (source[position] === '}') { position++; return result }
      while (position < source.length) {
        whitespace(); if (source[position] !== '"') return invalid()
        const key = string(); if (Object.hasOwn(result, key)) return invalid()
        whitespace(); if (source[position++] !== ':') return invalid()
        result[key] = value(depth + 1); whitespace()
        const delimiter = source[position++]; if (delimiter === '}') return result
        if (delimiter !== ',') return invalid()
      }
      return invalid()
    }
    if (character === '[') {
      position++; whitespace(); const result = []
      if (source[position] === ']') { position++; return result }
      while (position < source.length) {
        result.push(value(depth + 1)); whitespace()
        const delimiter = source[position++]; if (delimiter === ']') return result
        if (delimiter !== ',') return invalid()
      }
      return invalid()
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) if (source.startsWith(token, position)) { position += token.length; return result }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(position))
    if (!number) return invalid()
    position += number[0].length; return new NumberToken(number[0])
  }
  const raw = value(0); whitespace(); if (position !== source.length) return invalid()
  function materialize(current, key, currency) {
    if (current instanceof NumberToken) {
      if (MONEY_FIELDS.has(key)) return exactAmount(current.source, currency, ZERO_MONEY_FIELDS.has(key))
      if (!/^-?(?:0|[1-9]\d*)$/.test(current.source) || !Number.isSafeInteger(Number(current.source))) return invalid()
      return Number(current.source)
    }
    if (Array.isArray(current)) return current.map(entry => materialize(entry, undefined, currency))
    if (isRecord(current)) return Object.fromEntries(Object.entries(current).map(([field, entry]) => [field, materialize(entry, field, current.currency ?? currency)]))
    if (MONEY_FIELDS.has(key)) return invalid()
    return current
  }
  return materialize(raw)
}
function exactAmount(source, currency, allowZero = false) {
  if (!CURRENCIES.includes(currency)) return invalid()
  const parts = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source)
  if (!parts || source.length > 256) return invalid()
  const fraction = parts[2] || '', scale = BigInt(fraction.length) - BigInt(parts[3] || '0')
  if (scale > 2n) return invalid()
  const coefficient = `${parts[1]}${fraction}`.replace(/^0+/, ''), shift = 2n - scale
  if (!coefficient) return allowZero ? (currency === 'JPY' ? '0' : '0.00') : invalid()
  if (BigInt(coefficient.length) + shift > 12n) return invalid()
  const cents = BigInt(coefficient) * 10n ** shift
  if (cents > 100000000000n || (currency === 'JPY' && cents % 100n)) return invalid()
  return currency === 'JPY' ? String(cents / 100n) : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
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
