// One unresolved intent per mounted form, held only in memory. Never persist
// request text, credentials, or keys to browser storage. Reload/sign-out ends it.
export function newSubmissionKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure random generation is unavailable')
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}

const normalize = ({ title, reason, days }) => ({ title: title.trim(), reason: reason.trim(), days: Number(days) })
const signature = (actor, input) => JSON.stringify([actor, ...Object.values(normalize(input))])

// Only this explicit server rejection proves the keyed submission was never
// created. A generic 409, 503, malformed response or lost connection does not.
export function isRejectedSubmissionVersion(error) {
  const status = error?.response?.status ?? error?.status
  const message = error?.response?.data?.msg ?? error?.message
  return status === 409 && message === 'The published process changed; reload before submitting'
}

export function createSubmissionIntent(keyFactory = newSubmissionKey) {
  let pending = null
  return {
    current(actor, input) { return pending?.signature === signature(actor, input) ? pending : null },
    invalidate(actor, input) {
      if (pending?.signature !== signature(actor, input)) pending = null
    },
    prepare(actor, input, processVersion) {
      const fingerprint = signature(actor, input)
      if (pending?.signature !== fingerprint) {
        pending = Object.freeze({ signature: fingerprint, key: keyFactory(),
          payload: Object.freeze({ ...normalize(input), processVersion }) })
      }
      // Retain the original version even if refresh has discovered a publication.
      return pending
    },
    clear() { pending = null },
  }
}
