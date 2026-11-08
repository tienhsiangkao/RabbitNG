import test from 'node:test';
import assert from 'node:assert/strict';

test('only the latest generated roll can be acknowledged', async () => {
  const { createRngRoll, commitRngRoll } = await import('../src/rng-state.js');
  const entry = {};
  const first = createRngRoll(entry, () => 0);
  const second = createRngRoll(entry, () => 99);
  assert.deepEqual(first, { value: 0, rollId: 1 });
  assert.deepEqual(second, { value: 99, rollId: 2 });
  assert.equal(commitRngRoll(entry, first.value, first.rollId), false);
  assert.equal(commitRngRoll(entry, 50, second.rollId), false);
  assert.equal(commitRngRoll(entry, 99, '2'), false);
  assert.equal(commitRngRoll(entry, 99, second.rollId), true);
  assert.equal(entry.lastRngValue, 99);
  assert.equal(entry.lastCommittedRngValue, 99);
});

test('independent draws allow repeats and call the full 0..99 range', async () => {
  const { createRngRoll } = await import('../src/rng-state.js');
  const entry = {}, ranges = [];
  const rng = (...range) => { ranges.push(range); return 0; };
  assert.equal(createRngRoll(entry, rng).value, 0);
  assert.equal(createRngRoll(entry, rng).value, 0);
  assert.deepEqual(ranges, [[0, 100], [0, 100]]);
});
