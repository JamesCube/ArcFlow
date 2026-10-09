import { describe, expect, it } from 'vitest'
import { parseScenarioJson } from './scenario-api.js'
const parse = (value, currency = 'CNY') => parseScenarioJson(`{"field":"payment.netTotal","operator":"EQ","currency":"${currency}","threshold":${value}}`).threshold
describe('exact routing threshold response lexemes', () => {
  it.each([['0', 0], ['0e1000', 0], ['0e2147483647', 0], ['0e-2147483647', 0], ['0.0e2147483647', 0], ['1E+4', 10000], ['1.20', 1.2], ['1.0000', 1], ['1e-2', .01], ['20000000000', 20000000000], ['19999999999.99', 19999999999.99], ['2e10', 20000000000]])('accepts exact %s as numeric %s', (source, expected) => { expect(parse(source)).toBe(expected) })
  it.each(['-1', '0e2147483648', '0e-2147483649', '0e-2147483648', '0.0e-2147483647', '0.001', '1.0000000000000000000000001', '20000000000.01', '2.00000000000000000001e10', '1e999999', '1e-999999', '"10000"', 'null', 'true', '{}', '[]'])('rejects lossy or invalid threshold %s before native parsing', source => { expect(() => parse(source)).toThrow() })
  it('allows JPY whole numbers only and does not loosen other integral keys', () => {
    expect(parse('1E+4', 'JPY')).toBe(10000); expect(() => parse('1.01', 'JPY')).toThrow()
    expect(() => parse('1', 'XXX')).toThrow(); expect(() => parseScenarioJson('{"schemaVersion":4.0}')).toThrow()
  })
})
