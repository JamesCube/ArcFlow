// The demo emits Instant.toString() timestamps in UTC. Accept its four-digit
// calendar-year wire shape, retaining up to nine fractional digits. Unsupported
// zones/expanded years fail closed instead of passing through a lenient parser.
export function parseScenarioInstant(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value)
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null
  const whole = `${match[1]}T${match[2]}:${match[3]}:${match[4]}`
  const date = new Date(`${whole}Z`), millis = date.getTime()
  // Date.parse alone normalizes impossible days (e.g. February 30). The round
  // trip checks the actual calendar before converting the bounded whole second.
  if (!Number.isSafeInteger(millis) || date.toISOString() !== `${whole}.000Z`) return null
  return BigInt(millis) * 1000000n + BigInt((match[5] || '').padEnd(9, '0'))
}
