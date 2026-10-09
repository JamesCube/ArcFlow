import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeMessages, formatLeaveDays } from './locale.js';
for (const count of [0, 1, 2]) test(`native duration ${count} has natural English/Chinese units`, () => {
  assert.equal(formatLeaveDays(count, 'en'), `${count} ${count === 1 ? 'day' : 'days'}`);
  assert.equal(formatLeaveDays(count, 'zh-CN'), `${count}天`);
  assert.equal(nativeMessages('en').days, 'Days'); assert.equal(nativeMessages('zh-CN').days, '天数');
});
