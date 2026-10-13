import test from 'node:test'
import assert from 'node:assert/strict'
import {assertSameProcessBirth} from '../e2e/graph-business-restart.mjs'
const initial = {pid: 12, spawnedAt: '2026-10-13T00:00:00Z', observedAt: '2026-10-13T00:00:01Z', linuxStartTicks: '100', startTimeSource: 'linux-proc-stat'}
test('independent observation timestamps do not change the same process birth', () => {
  assert.doesNotThrow(() => assertSameProcessBirth({...initial, observedAt: '2026-10-13T00:01:00Z'}, initial))
})
for (const [field, replacement] of [['pid', 13], ['spawnedAt', '2026-10-13T00:00:10Z'], ['linuxStartTicks', '101'], ['startTimeSource', 'other']]) {
  test(`a changed ${field} cannot masquerade as the same process`, () => assert.throws(() => assertSameProcessBirth({...initial, [field]: replacement}, initial)))
}
test('missing process identity or observation time is rejected', () => {
  assert.throws(() => assertSameProcessBirth({...initial, pid: undefined}, initial))
  assert.throws(() => assertSameProcessBirth({...initial, observedAt: null}, initial))
})
