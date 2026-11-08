import test from "node:test";
import assert from "node:assert/strict";
import { updateUnmatchedTableMisses } from "../src/overlay-retention.js";

test("unmatched table overlays are retained below the threshold", () => {
  assert.deepEqual(
    updateUnmatchedTableMisses(2, { threshold: 4 }),
    { nextMisses: 3, destroy: false }
  );
});

test("unmatched table overlays are destroyed when the threshold is reached", () => {
  assert.deepEqual(
    updateUnmatchedTableMisses(3, { threshold: 4 }),
    { nextMisses: 4, destroy: true }
  );
});

test("minimized tables do not count as closed table misses", () => {
  assert.deepEqual(
    updateUnmatchedTableMisses(3, { threshold: 4, minimized: true }),
    { nextMisses: 0, destroy: false }
  );
});

test("hidden unmatched windows expire faster because closed tables can remain hidden briefly", () => {
  assert.deepEqual(
    updateUnmatchedTableMisses(1, { threshold: 6, visible: false }),
    { nextMisses: 2, destroy: true }
  );
});
