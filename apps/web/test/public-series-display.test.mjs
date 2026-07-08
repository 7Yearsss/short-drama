import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiClient = readFileSync(new URL('../lib/api-client.ts', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/series/[id]/page.tsx', import.meta.url), 'utf8');

test('api client exposes update status and latest publishing fields', () => {
  assert.match(apiClient, /updateStatus: string/);
  assert.match(apiClient, /lastPublishedEpisodeAt: string \| null/);
});

test('homepage shows free series and update status labels', () => {
  assert.match(homePage, /免费观看/);
  assert.match(homePage, /UPDATE_STATUS_LABEL/);
  assert.match(homePage, /series\.unlockPriceCents === 0/);
});

test('detail page does not lock episodes for free series', () => {
  assert.match(detailPage, /const isFreeSeries = series\?\.unlockPriceCents === 0/);
  assert.match(detailPage, /!isFreeSeries && episode\.episodeNumber > freeEpisodeCount/);
});
