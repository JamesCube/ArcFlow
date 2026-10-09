import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUSINESS_KEYS, InvalidSealUse, validateSealUse, normalizeSealUse, serializeSealUse,
  validateSealUseForm, normalizeSealUseForm, serializeSealUsePayload,
} from './seal-use.mjs'

const fixture = overrides => ({
  type: 'sealUse', documentVersion: 1, businessId: 'SEAL-PROXY-001',
  title: 'Synthetic proxy fixture', reason: 'Synthetic boundary checks',
  documentName: 'Synthetic document', documentRef: 'synthetic:proxy/001',
  sealType: 'OFFICIAL', copyCount: 1, ...overrides,
})

test('regression: Proxy cannot change copyCount from 1 during validation to 101 during normalization', () => {
  let gets = 0
  const proxy = new Proxy(fixture(), {
    get(target, key, receiver) {
      if (key === 'copyCount') return ++gets === 1 ? 1 : 101
      return Reflect.get(target, key, receiver)
    },
  })
  const normalized = normalizeSealUse(proxy)
  assert.equal(normalized.copyCount, 1)
  assert.equal(gets, 0)
  assert.deepEqual(validateSealUse(normalized), [])
  assert.ok(Object.isFrozen(normalized))
})

test('descriptor values are captured once and cannot change on a later descriptor read', () => {
  const counts = new Map()
  const proxy = new Proxy(fixture(), {
    get() { throw new Error('Property reads must not occur') },
    getOwnPropertyDescriptor(target, key) {
      counts.set(key, (counts.get(key) || 0) + 1)
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      return key === 'copyCount' ? { ...descriptor, value: counts.get(key) === 1 ? 1 : 101 } : descriptor
    },
  })
  assert.equal(normalizeSealUse(proxy).copyCount, 1)
  assert.deepEqual([...counts.keys()], BUSINESS_KEYS)
  assert.ok([...counts.values()].every(count => count === 1))
})

test('captured invalid descriptor values reject even when get traps would return valid values', () => {
  let gets = 0
  const proxy = new Proxy(fixture({ copyCount: 101 }), {
    get(target, key, receiver) {
      gets++
      return key === 'copyCount' ? 1 : Reflect.get(target, key, receiver)
    },
  })
  assert.equal(validateSealUse(proxy)[0].path, 'copyCount')
  assert.throws(() => normalizeSealUse(proxy), InvalidSealUse)
  assert.throws(() => serializeSealUse(proxy), InvalidSealUse)
  assert.equal(gets, 0)
})

test('accessor fields reject without invoking the accessor in business, form or envelope APIs', () => {
  let gets = 0
  const business = fixture()
  Object.defineProperty(business, 'title', { enumerable: true, get() { gets++; return 'Synthetic title' } })
  assert.equal(validateSealUse(business)[0].code, 'fields')
  assert.throws(() => normalizeSealUse(business), InvalidSealUse)
  const form = fixture({ copyCount: '1' })
  Object.defineProperty(form, 'copyCount', { enumerable: true, get() { gets++; return '1' } })
  assert.equal(validateSealUseForm(form)[0].code, 'fields')
  assert.throws(() => normalizeSealUseForm(form), InvalidSealUse)
  const payload = { business: fixture(), processVersion: 1 }
  Object.defineProperty(payload, 'processVersion', { enumerable: true, get() { gets++; return 1 } })
  assert.throws(() => serializeSealUsePayload(payload), InvalidSealUse)
  assert.equal(gets, 0)
})

test('revoked proxies and failed reflection fail closed as validation issues', () => {
  const revoked = Proxy.revocable(fixture(), {}); revoked.revoke()
  const proxies = [revoked.proxy,
    new Proxy(fixture(), { getPrototypeOf() { throw new Error('bad prototype') } }),
    new Proxy(fixture(), { ownKeys() { throw new Error('bad own keys') } }),
    new Proxy(fixture(), { getOwnPropertyDescriptor() { throw new Error('bad descriptor') } }),
  ]
  for (const proxy of proxies) {
    assert.equal(validateSealUse(proxy)[0].code, 'fields')
    assert.throws(() => normalizeSealUse(proxy), InvalidSealUse)
    assert.equal(validateSealUseForm(proxy)[0].code, 'fields')
    assert.throws(() => normalizeSealUseForm(proxy), InvalidSealUse)
    assert.throws(() => serializeSealUsePayload(proxy), InvalidSealUse)
  }
})

test('reported own keys must match the schema even if a proxy offers descriptors for absent keys', () => {
  const wrongKeys = new Proxy(fixture(), {
    ownKeys(target) { return Reflect.ownKeys(target).map(key => key === 'title' ? 'foreign' : key) },
  })
  const missingDescriptor = new Proxy(fixture(), {
    getOwnPropertyDescriptor(target, key) { return key === 'title' ? undefined : Reflect.getOwnPropertyDescriptor(target, key) },
  })
  for (const proxy of [wrongKeys, missingDescriptor]) {
    assert.equal(validateSealUse(proxy)[0].code, 'fields')
    assert.throws(() => normalizeSealUse(proxy), InvalidSealUse)
  }
})

test('form normalization snapshots raw text once without calling property get traps', () => {
  let gets = 0
  const counts = new Map(), original = fixture({ copyCount: ' 02 ' })
  const proxy = new Proxy(original, {
    get(target, key, receiver) {
      if (key === 'copyCount') return ++gets === 1 ? ' 02 ' : '101'
      return Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      counts.set(key, (counts.get(key) || 0) + 1)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  const normalized = normalizeSealUseForm(proxy)
  assert.equal(normalized.copyCount, 2)
  assert.equal(original.copyCount, ' 02 ')
  assert.equal(gets, 0)
  assert.ok([...counts.values()].every(count => count === 1))
  assert.deepEqual(validateSealUse(normalized), [])
})

test('submit envelope snapshots outer values and nested business before using them', () => {
  let gets = 0
  const outerCounts = new Map(), businessCounts = new Map()
  const business = new Proxy(fixture(), {
    get() { gets++; throw new Error('Nested get trap') },
    getOwnPropertyDescriptor(target, key) {
      businessCounts.set(key, (businessCounts.get(key) || 0) + 1)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  const payload = new Proxy({ business, processVersion: 1 }, {
    get(target, key, receiver) {
      gets++
      return key === 'processVersion' ? 0 : Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      outerCounts.set(key, (outerCounts.get(key) || 0) + 1)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assert.deepEqual(JSON.parse(serializeSealUsePayload(payload)), { business: fixture(), processVersion: 1 })
  assert.equal(gets, 0)
  assert.ok([...outerCounts.values(), ...businessCounts.values()].every(count => count === 1))
})

test('normalization retains no mutable object field reference and supports null-prototype data', () => {
  const value = Object.assign(Object.create(null), fixture())
  assert.deepEqual(normalizeSealUse(value), fixture())
  const mutable = { text: 'Synthetic text' }
  for (const key of BUSINESS_KEYS) assert.throws(() => normalizeSealUse(fixture({ [key]: mutable })), InvalidSealUse)
  value.copyCount = 100
  const result = normalizeSealUse(value)
  value.copyCount = 101
  assert.equal(result.copyCount, 100)
  assert.ok(Object.values(result).every(field => typeof field !== 'object'))
})
