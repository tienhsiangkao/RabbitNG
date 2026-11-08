import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStakes, stakeBadgeForTitle } from '../src/table-stakes.js';

test('actual blinds determine NL500 even when GG names or table numbers differ', () => {
  for (const title of ['NLH Gold 08 - $2 / $5', '[#] NLH Gold 08 - $2.50 / $5.00 [#]', 'NLH Platinum 08 - $2 / $5']) {
    const badge = stakeBadgeForTitle(title);
    assert.equal(badge.text, 'NL500');
    assert.equal(badge.level, 500);
    assert.equal(badge.source, 'blinds');
  }
  assert.equal(stakeBadgeForTitle('NLH Gold 08 - $1 / $2').level, 200);
});

test('only the user-confirmed abbreviated Gold 08 name is an NL500 fallback', () => {
  assert.equal(stakeBadgeForTitle('NLH Gold 08').text, 'NL500');
  assert.equal(stakeBadgeForTitle('[#] NLH Gold 08 [#]').source, 'confirmed-title');
  assert.equal(stakeBadgeForTitle('NLH Gold 09'), null);
  assert.equal(stakeBadgeForTitle('NLH Unknown 08'), null);
});

test('Rush labels retain their Z notation and share the same stake-level colors', () => {
  const rush = stakeBadgeForTitle('Rush & Cash - $0.10 / $0.25');
  const regular = stakeBadgeForTitle('NLH Red 08 - $0.10 / $0.25');
  assert.equal(rush.text, 'Z25');
  assert.equal(regular.text, 'NL25');
  assert.equal(rush.color, regular.color);
  assert.equal(stakeBadgeForTitle('Rush & Cash - $2 / $5').color, stakeBadgeForTitle('NLH Gold 08 - $2 / $5').color);
  assert.notEqual(rush.color, stakeBadgeForTitle('NLH Gold 08 - $2 / $5').color);
  assert.equal(stakeBadgeForTitle('PLO Gold 08 - $2 / $5').text, 'PLO500');
});

test('all supported standard levels have distinct badge colors', () => {
  const levels = [2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000];
  const blinds = [[.01, .02], [.02, .05], [.05, .1], [.1, .25], [.25, .5], [.5, 1], [1, 2], [2, 5], [5, 10], [10, 20]];
  const badges = blinds.map(([small, big]) => stakeBadgeForTitle(`NLH Table - $${small} / $${big}`));
  assert.deepEqual(badges.map(b => b.level), levels);
  assert.equal(new Set(badges.map(b => b.color)).size, levels.length);
});

test('blind parsing supports cents, thousands and antes while rejecting malformed amounts', () => {
  assert.deepEqual(parseStakes('NLHA - $1,000 / $2,000 ($500)'), { small: 1000, big: 2000, ante: 500 });
  assert.deepEqual(parseStakes('NLH - $0.5/$1'), { small: .5, big: 1, ante: null });
  for (const title of ['NLH - $0 / $0', 'NLH - $5 / $2', 'NLH - $2.500 / $5', 'NLH - $1,00 / $2,00', 'NLH Gold 08']) {
    assert.equal(parseStakes(title), null, title);
  }
});
