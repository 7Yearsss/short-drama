import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPage = readFileSync(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');
const workbenchPage = readFileSync(new URL('../app/admin/series/[id]/page.tsx', import.meta.url), 'utf8');

test('admin series rows expose a visible workbench action', () => {
  assert.match(adminPage, /href=\{`\/admin\/series\/\$\{s\.id\}`\}/);
  assert.match(adminPage, />\s*运营工作台\s*</);
});

test('admin list includes search and status filters', () => {
  assert.match(adminPage, /placeholder="搜索剧名"/);
  assert.match(adminPage, /value=\{statusFilter\}/);
  assert.match(adminPage, /value=\{updateStatusFilter\}/);
});

test('admin list displays free and update status labels', () => {
  assert.match(adminPage, /s\.unlockPriceCents === 0/);
  assert.match(adminPage, /UPDATE_STATUS_LABEL/);
});

test('series workbench includes publishing, replacement, and audit sections', () => {
  assert.match(workbenchPage, />\s*基础信息\s*</);
  assert.match(workbenchPage, />\s*发布检查\s*</);
  assert.match(workbenchPage, />\s*上传新集数\s*</);
  assert.match(workbenchPage, />\s*最近操作\s*</);
  assert.match(workbenchPage, /replacement\/upload/);
  assert.match(workbenchPage, /replacement\/confirm/);
});

test('series workbench suggests the next episode number', () => {
  assert.match(workbenchPage, /nextEpisodeNumber/);
  assert.match(workbenchPage, /Math\.max/);
});
