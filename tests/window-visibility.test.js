import test from "node:test";
import assert from "node:assert/strict";

import { isPokerTableWindowEffectivelyVisible } from "../src/window-visibility.js";

function nativeWindow({ bounds, visible = true, minimized = false } = {}) {
  return {
    getBounds: () => bounds ?? { x: 10, y: 20, width: 800, height: 600 },
    isVisible: () => visible,
    isMinimized: () => minimized
  };
}

test("accepts a normally visible native table window", () => {
  assert.equal(isPokerTableWindowEffectivelyVisible(nativeWindow()), true);
});

test("hidden poker client windows must not create floating overlays", () => {
  assert.equal(
    isPokerTableWindowEffectivelyVisible(nativeWindow({ visible: false }), {
      knownPokerClient: true
    }),
    false
  );
});

test('unknown visibility and closed handles are not visible', () => {
  assert.equal(isPokerTableWindowEffectivelyVisible({ getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) }), false);
  assert.equal(isPokerTableWindowEffectivelyVisible({ ...nativeWindow(), isWindow: () => false }), false);
});

test("does not apply the visibility fallback to an unknown process", () => {
  assert.equal(
    isPokerTableWindowEffectivelyVisible(nativeWindow({ visible: false })),
    false
  );
});

test("rejects minimized or zero-size windows even for verified poker clients", () => {
  assert.equal(
    isPokerTableWindowEffectivelyVisible(nativeWindow({ minimized: true }), {
      knownPokerClient: true
    }),
    false
  );
  assert.equal(
    isPokerTableWindowEffectivelyVisible(
      nativeWindow({ bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false }),
      { knownPokerClient: true }
    ),
    false
  );
});
