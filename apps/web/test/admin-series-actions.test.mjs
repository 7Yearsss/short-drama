import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPage = readFileSync(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');

test('admin series rows expose a visible episode management action', () => {
  assert.match(adminPage, /href=\{`\/admin\/series\/\$\{s\.id\}`\}/);
  assert.match(adminPage, />\s*管理集数\s*</);
});
