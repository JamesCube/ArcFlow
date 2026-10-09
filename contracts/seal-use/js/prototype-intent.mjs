// LOCAL TEST PROTOTYPE ONLY. Not a wire, persistence, signature or submission-key
// protocol. Actual integration must compare canonical values and design its own
// actor/process/key scoping; this helper makes no idempotency or security claim.
import { BUSINESS_KEYS, normalizeSealUse } from './seal-use.mjs'

/**
 * Deterministic business-intent framing, matching the Java contract proposal.
 * SHA-256 is deliberately supplied by the caller's trusted crypto implementation.
 * Prefix ASCII bytes + NUL; then for each BUSINESS_KEYS value: uint32-be UTF-16
 * code-unit length followed by uint16-be code units. No UTF-8 replacement of
 * unpaired surrogates; processVersion/actor/key are outside this business digest.
 */
export function sealUseIntentBytes(business) {
  const normalized = normalizeSealUse(business)
  const prefix = 'arcflow.sealUse.intent.v1\0'
  const values = BUSINESS_KEYS.map(key => String(normalized[key]))
  const bytes = new Uint8Array(prefix.length + values.reduce((sum, value) => sum + 4 + value.length * 2, 0))
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const character of prefix) bytes[offset++] = character.charCodeAt(0)
  for (const value of values) {
    view.setUint32(offset, value.length, false); offset += 4
    for (let index = 0; index < value.length; index++) {
      view.setUint16(offset, value.charCodeAt(index), false); offset += 2
    }
  }
  return bytes
}
