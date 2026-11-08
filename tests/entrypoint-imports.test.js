import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('main entrypoint has a complete relative module graph', () => {
  const seen = new Set();
  function visit(file) {
    if (seen.has(file.href)) return;
    seen.add(file.href);
    assert.ok(fs.existsSync(file), `Main-process startup imports missing module: ${file.pathname}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([.][^'"]+)['"]/g)) {
      visit(new URL(specifier, file));
    }
  }
  const manifest=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  visit(new URL('../'+manifest.main, import.meta.url));
});
