import test from "node:test";
import assert from "node:assert/strict";
import { dedupeTableWindows } from "../src/window-dedupe.js";

function fakeWindow(id, title, bounds) {
  return {
    id,
    getTitle: () => title,
    getBounds: () => ({ ...bounds })
  };
}

test("dedupeTableWindows keeps one table per exact title and bounds", () => {
  const left = fakeWindow(1, "Rush & Cash - $0.05 / $0.10", { x: 430, y: 0, width: 1490, height: 1056 });
  const rightA = fakeWindow(2, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 0, width: 1490, height: 1056 });
  const rightB = fakeWindow(3, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 0, width: 1490, height: 1056 });

  const result = dedupeTableWindows([left, rightA, rightB]);

  assert.deepEqual(result.windows.map((win) => win.id), [1, 2]);
  assert.deepEqual(result.duplicateIds, [3]);
  assert.equal(result.canonicalIdById.get(1), 1);
  assert.equal(result.canonicalIdById.get(2), 2);
  assert.equal(result.canonicalIdById.get(3), 2);
});

test("dedupeTableWindows preserves the window that already owns an overlay", () => {
  const first = fakeWindow(10, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 1056, width: 1490, height: 1056 });
  const existing = fakeWindow(11, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 1056, width: 1490, height: 1056 });

  const result = dedupeTableWindows([first, existing], new Set([11]));

  assert.deepEqual(result.windows.map((win) => win.id), [11]);
  assert.deepEqual(result.duplicateIds, [10]);
  assert.equal(result.canonicalIdById.get(10), 11);
  assert.equal(result.canonicalIdById.get(11), 11);
});

test("dedupeTableWindows treats tiny bounds jitter as the same physical table", () => {
  const first = fakeWindow(20, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 0, width: 1490, height: 1056 });
  const jittered = fakeWindow(21, "Rush & Cash - $0.05 / $0.10", { x: 1925, y: 3, width: 1486, height: 1058 });

  const result = dedupeTableWindows([first, jittered]);

  assert.deepEqual(result.windows.map((win) => win.id), [20]);
  assert.deepEqual(result.duplicateIds, [21]);
  assert.equal(result.canonicalIdById.get(20), 20);
  assert.equal(result.canonicalIdById.get(21), 20);
});

test("dedupeTableWindows keeps same-title tables in different screen slots", () => {
  const left = fakeWindow(30, "Rush & Cash - $0.05 / $0.10", { x: 430, y: 0, width: 1490, height: 1056 });
  const right = fakeWindow(31, "Rush & Cash - $0.05 / $0.10", { x: 1920, y: 0, width: 1490, height: 1056 });

  const result = dedupeTableWindows([left, right]);

  assert.deepEqual(result.windows.map((win) => win.id), [30, 31]);
  assert.deepEqual(result.duplicateIds, []);
  assert.equal(result.canonicalIdById.get(30), 30);
  assert.equal(result.canonicalIdById.get(31), 31);
});
