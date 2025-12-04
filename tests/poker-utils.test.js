import test from "node:test";
import assert from "node:assert/strict";
import { parseStakes, isStrictRushCashTableTitle, buildColorTierRegexFromConfig } from "../src/table-helpers.js";

test("parseStakes parses small/big/ante", () => {
  const parsed = parseStakes("NLH $0.10 / $0.25 ($0.05)");
  assert.deepEqual(parsed, { small: 0.1, big: 0.25, ante: 0.05 });
});

test("parseStakes tolerates simple numeric stakes", () => {
  const parsed = parseStakes("PLO 1 / 2");
  assert.deepEqual(parsed, { small: 1, big: 2, ante: null });
});

test("isStrictRushCashTableTitle enforces Rush & Cash formatting", () => {
  assert.equal(isStrictRushCashTableTitle("[#] Rush & Cash $0.10 / $0.25 [#]"), true);
  assert.equal(isStrictRushCashTableTitle("Rush & Cash NLH"), false);
});

test("buildColorTierRegexFromConfig matches bracketed color-tier titles", () => {
  const regex = buildColorTierRegexFromConfig({
    tiers: { red: { maxBigBlind: 0.25 }, gold: { maxBigBlind: 5 } }
  });
  assert.ok(regex);
  assert.ok(regex.test("[#] NLH gold 12 - $2 / $5 [#]"));
  assert.ok(!regex.test("NLH gold 12 - $2 / $5")); // missing brackets
});
