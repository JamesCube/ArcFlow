// Shared fixture parity only; this does not execute Java or prove host integration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { InvalidSealUse, readSealUse, serializeSealUse } from './seal-use.mjs'
import { sealUseIntentBytes } from './prototype-intent.mjs'

const vectors = JSON.parse(readFileSync(new URL('../java/src/test/resources/seal-use-vectors.json', import.meta.url), 'utf8'))
for (const vector of vectors.valid) {
  test(`shared valid vector: ${vector.name}`, () => {
    const normalized = readSealUse(vector.raw)
    assert.deepEqual(normalized, JSON.parse(vector.canonical))
    assert.equal(serializeSealUse(normalized), vector.canonical)
    assert.deepEqual(readSealUse(serializeSealUse(normalized)), normalized)
    assert.equal(createHash('sha256').update(sealUseIntentBytes(normalized)).digest('hex'), vector.fingerprint)
  })
}
for (const vector of vectors.invalid) {
  test(`shared invalid vector: ${vector.name}`, () => {
    assert.throws(() => readSealUse(vector.raw), InvalidSealUse)
  })
}

const inputPolicy = JSON.parse(readFileSync(new URL('../java/src/test/resources/seal-use-raw-input-policy.json', import.meta.url), 'utf8'))
const baseline = vectors.valid[0]
for (const offset of inputPolicy.acceptedLengthOffsets) {
  test(`shared raw JSON source limit accepts ${inputPolicy.maxUtf16CodeUnits + offset} UTF-16 units`, () => {
    const length = inputPolicy.maxUtf16CodeUnits + offset
    const source = ' '.repeat(length - baseline.raw.length) + baseline.raw
    assert.equal(source.length, length)
    assert.deepEqual(readSealUse(source), JSON.parse(baseline.canonical))
  })
}
for (const offset of inputPolicy.rejectedLengthOffsets) {
  test(`shared raw JSON source limit rejects ${inputPolicy.maxUtf16CodeUnits + offset} UTF-16 units`, () => {
    const length = inputPolicy.maxUtf16CodeUnits + offset
    const source = baseline.raw + ' '.repeat(length - baseline.raw.length)
    assert.equal(source.length, length)
    assert.throws(() => readSealUse(source), InvalidSealUse)
  })
}
