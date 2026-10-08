import { describe, expect, it, vi } from 'vitest'
import { createScenarioApi, parseScenarioJson, InvalidScenarioPayload } from './scenario-api.js'
import { deferred } from './scenario-fixtures.js'
const response = (source, status = 200) => ({ ok: status >= 200 && status < 300, status, text: vi.fn().mockResolvedValue(source) })

describe('lossless scenario JSON transport', () => {
  it('retains decimal money and scientific numeric lexemes before JSON rounding can occur', () => {
    const value = parseScenarioJson('{"currency":"CNY","lines":[{"amount":0.10},{"amount":1.25e2},{"amount":1E+9}],"version":2147483647}')
    expect(value).toEqual({ currency: 'CNY', lines: [{ amount: '0.10' }, { amount: '125.00' }, { amount: '1000000000.00' }], version: 2147483647 })
    expect(parseScenarioJson('{"business":{"currency":"JPY","lines":[{"amount":100.00}]}}').business.lines[0].amount).toBe('100')
  })
  it.each(['"0.10"', 'true', 'null', '0', '-1', '1.001', '1.00000000000000001', '1e-3', '1000000000.01', '1e100000', '1e-100000'])('rejects invalid or imprecise numeric amount %s', amount => expect(() => parseScenarioJson(`{"currency":"CNY","amount":${amount}}`)).toThrow(InvalidScenarioPayload))
  it('never accepts fractional yen or money without a supported enclosing currency', () => {
    expect(() => parseScenarioJson('{"currency":"JPY","amount":1.01}')).toThrow(InvalidScenarioPayload)
    expect(() => parseScenarioJson('{"amount":1}')).toThrow(InvalidScenarioPayload)
    expect(() => parseScenarioJson('{"currency":"BTC","amount":1}')).toThrow(InvalidScenarioPayload)
  })
  it.each(['', 'undefined', '{', '[1,]', '{"a":1,}', '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":01}', '{"a":1.0}', '{"a":1e2}', '{"a":9007199254740992}', '{"a":1} false', '"unterminated', '"bad\nstring"'])('fails closed on malformed, duplicate or coercive JSON %j', source => expect(() => parseScenarioJson(source)).toThrow(InvalidScenarioPayload))
  it('bounds nesting and response size and treats prototype-looking fields only as ordinary data', () => {
    expect(() => parseScenarioJson('['.repeat(66) + '0' + ']'.repeat(66))).toThrow(InvalidScenarioPayload)
    expect(() => parseScenarioJson(' '.repeat(8000001))).toThrow(InvalidScenarioPayload)
    const value = parseScenarioJson('{"__proto__":{"polluted":true},"constructor":"plain","text":"\\\"escaped\\\""}')
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect({}.polluted).toBeUndefined()
    expect(value.text).toBe('"escaped"')
  })
})

describe('isolated credential-aware scenario API', () => {
  it('uses same-origin API, UTF-8 Basic auth, no ambient credentials or cache, and protected headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('{"id":"alice"}'))
    const api = createScenarioApi(fetcher); api.login('alice', 'pāssword')
    await api.request('/me', { headers: { Authorization: 'untrusted', 'Idempotency-Key': 'expense-1' } })
    expect(fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'omit', cache: 'no-store', headers: expect.objectContaining({ 'X-Arcflow-Client': 'approval-demo', 'Content-Type': 'application/json', 'Idempotency-Key': 'expense-1', Authorization: `Basic ${Buffer.from('alice:pāssword').toString('base64')}` }) }))
    api.logout(); await api.request('/me')
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('')
  })
  it('preserves request data and returns validated decimal strings', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('{"currency":"USD","amount":1.20}'))
    const api = createScenarioApi(fetcher)
    expect(await api.request('/scenarios/oa-expense/documents', { method: 'POST', body: '{"synthetic":true}' })).toEqual({ currency: 'USD', amount: '1.20' })
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"synthetic":true}' })
  })
  it('normalizes JSON and non-JSON errors without masking their status', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('{"message":"Stale process version"}', 409)).mockResolvedValueOnce(response('<h1>Unavailable</h1>', 503))
    const api = createScenarioApi(fetcher)
    await expect(api.request('/process')).rejects.toMatchObject({ message: 'Stale process version', status: 409 })
    await expect(api.request('/requests')).rejects.toMatchObject({ message: 'Request failed (503)', status: 503 })
  })
  it('rejects malformed success responses rather than acknowledging a saved request', async () => {
    const api = createScenarioApi(vi.fn().mockResolvedValue(response('{"currency":"CNY","amount":1.00000000000000001}')))
    await expect(api.request('/requests')).rejects.toBeInstanceOf(InvalidScenarioPayload)
  })
  it.each(['logout', 'login'])('aborts requests and suppresses late responses on %s', async action => {
    const pending = deferred(), fetcher = vi.fn().mockImplementation(() => pending.promise), api = createScenarioApi(fetcher)
    api.login('alice', 'secret')
    const request = api.request('/requests'), failure = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    if (action === 'logout') api.logout(); else api.login('bob', 'other')
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    pending.resolve(response('[]'))
    await failure
  })
  it('suppresses a late body read after session isolation changes', async () => {
    const body = deferred(), api = createScenarioApi(vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => body.promise }))
    const request = api.request('/requests'), failure = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve(); api.logout(); body.resolve('[]'); await failure
  })
  it('honors callers’ pre-aborted signals without invoking fetch', async () => {
    const controller = new AbortController(); controller.abort()
    const fetcher = vi.fn(), api = createScenarioApi(fetcher)
    await expect(api.request('/requests', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('forwards callers’ cancellation and rejects even when fetch ignores it', async () => {
    const controller = new AbortController(), pending = deferred(), fetcher = vi.fn().mockImplementation(() => pending.promise), api = createScenarioApi(fetcher)
    const request = api.request('/requests', { signal: controller.signal }), failure = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    pending.resolve(response('[]')); await failure
  })
})
