// Shared shape of Chromium full-page captures. Integrity is not authenticity.
import assert from 'node:assert/strict'
import { crc32, inflateSync } from 'node:zlib'
const maxPngBytes = 64 * 1024 * 1024, maxInflatedBytes = 128 * 1024 * 1024
// Chromium emits non-interlaced 8-bit RGB/RGBA PNGs. Validate the complete
// encoded image, not just its header. This proves integrity, not authenticity.
export function validatePng(bytes) {
  assert.ok(bytes.length <= maxPngBytes, 'PNG exceeds the encoded size limit')
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Invalid PNG signature')
  let offset = 8, width, height, channels, seenHeader = false, seenPalette = false, ended = false, closedData = false
  const data = []
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    assert.ok(end <= bytes.length, 'Truncated PNG chunk data')
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1'), payload = bytes.subarray(offset + 8, end - 4)
    assert.match(type, /^[A-Za-z]{2}[A-Z][A-Za-z]$/, 'Invalid PNG chunk type')
    assert.equal(bytes.readUInt32BE(end - 4), crc32(bytes.subarray(offset + 4, end - 4)), `Invalid PNG ${type} CRC`)
    assert.ok(seenHeader || type === 'IHDR', 'PNG must start with IHDR')
    if (type === 'IHDR') {
      assert.ok(!seenHeader && offset === 8, 'Duplicate or misplaced PNG header'); assert.equal(length, 13)
      seenHeader = true; width = payload.readUInt32BE(0); height = payload.readUInt32BE(4)
      assert.ok(width > 0 && height > 0 && width <= 32768 && height <= 32768, 'PNG dimensions exceed the supported bounds')
      assert.equal(payload[8], 8, 'Only 8-bit browser captures are supported')
      assert.ok([2, 6].includes(payload[9]), 'Only RGB/RGBA browser captures are supported'); channels = payload[9] === 2 ? 3 : 4
      assert.deepEqual([...payload.subarray(10)], [0, 0, 0], 'Unsupported PNG compression, filter or interlace method')
    } else if (type === 'IDAT') {
      assert.ok(!closedData, 'PNG IDAT chunks must be consecutive'); data.push(payload)
    } else {
      if (data.length) closedData = true
      if (type === 'IEND') {
        assert.equal(length, 0); assert.ok(data.length, 'PNG has no IDAT'); assert.equal(end, bytes.length, 'Data after PNG IEND')
        ended = true
      } else if (type === 'PLTE') {
        assert.ok(!seenPalette && !data.length && length > 0 && length <= 768 && length % 3 === 0, 'Invalid PNG palette'); seenPalette = true
      } else assert.ok(type[0] === type[0].toLowerCase(), `Unsupported critical PNG chunk ${type}`)
    }
    offset = end
  }
  assert.ok(seenHeader && ended && data.length, 'Incomplete PNG image')
  const rowLength = width * channels + 1, expectedLength = rowLength * height
  assert.ok(expectedLength <= maxInflatedBytes, 'PNG exceeds the decoded size limit')
  const compressed = Buffer.concat(data), inflated = inflateSync(compressed, { maxOutputLength: expectedLength, info: true })
  assert.equal(inflated.engine.bytesWritten, compressed.length, 'Trailing data in PNG zlib stream')
  assert.equal(inflated.buffer.length, expectedLength, 'Invalid PNG scanline length')
  for (let row = 0; row < height; row++) assert.ok(inflated.buffer[row * rowLength] <= 4, 'Invalid PNG scanline filter')
  return { width, height }
}
