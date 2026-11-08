import test from "node:test";
import assert from "node:assert/strict";
import { anchorsEqual, normalizedAnchorFromRect } from "../src/overlay-position.js";

test("normalizedAnchorFromRect saves table-relative position", () => {
  assert.deepEqual(
    normalizedAnchorFromRect(
      { x: 300, y: 450, width: 80, height: 60 },
      { x: 100, y: 50, width: 1000, height: 800 }
    ),
    { xPct: 0.2, yPct: 0.5 }
  );
});

test("normalizedAnchorFromRect clamps dragged positions to the table", () => {
  assert.deepEqual(
    normalizedAnchorFromRect(
      { x: -100, y: 2000, width: 80, height: 60 },
      { x: 100, y: 50, width: 1000, height: 800 }
    ),
    { xPct: 0, yPct: 1 }
  );
});

test("anchorsEqual compares anchors with small tolerance", () => {
  assert.equal(
    anchorsEqual({ xPct: 0.20001, yPct: 0.5 }, { xPct: 0.2, yPct: 0.50001 }),
    true
  );
  assert.equal(
    anchorsEqual({ xPct: 0.21, yPct: 0.5 }, { xPct: 0.2, yPct: 0.5 }),
    false
  );
});
