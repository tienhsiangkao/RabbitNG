import test from 'node:test';
import assert from 'node:assert/strict';
test('timer mode defaults to three seconds and never migrates old zero to disabled', async () => {
  const { timerSeconds } = await import('../src/timer-settings.js');
  for (const value of [0, -1, undefined, NaN, Infinity]) assert.equal(timerSeconds(value), 3);
  assert.equal(timerSeconds(1), 1);
  assert.equal(timerSeconds(60), 60);
  assert.equal(timerSeconds(99), 60);
  assert.equal(timerSeconds(2.9), 2);
});
