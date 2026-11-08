import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as layout from '../src/table-layout.js';

function harness() {
  const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  let requests = 0, stops = 0, restores = 0;
  const context = vm.createContext({ ...layout,
    settings: { tableLayout: layout.normalizeTableLayoutSettings({ enabled: true }) },
    requestTableLayoutApply: () => requests++,
    tableLayoutManager: { stop: () => stops++, restore: () => restores++ },
  });
  const start = source.indexOf('function applyTableLayoutSettingsPatch(');
  const end = source.indexOf('\nfunction currentSettingsPayload(', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, counts: () => ({ requests, stops, restores }) };
}
test('saving settings and switching saved profiles does not immediately move windows', () => {
  const { context, counts } = harness();
  context.applyTableLayoutSettingsPatch({ profile: { id: 'default', name: 'My layout', columns: 3 } });
  context.applyTableLayoutSettingsPatch({ arrangeOnStartup: true, restoreOnStop: true });
  assert.deepEqual(counts(), { requests: 0, stops: 0, restores: 0 });
  assert.equal(context.settings.tableLayout.arrangeOnStartup, true);
  assert.equal(context.settings.tableLayout.restoreOnStop, true);
  context.applyTableLayoutSettingsPatch({ applyNow: true });
  assert.equal(counts().requests, 1);
});
test('disabling management stops it without implicit restoration', () => {
  const { context, counts } = harness();
  context.applyTableLayoutSettingsPatch({ enabled: false });
  assert.deepEqual(counts(), { requests: 0, stops: 1, restores: 0 });
});
