import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const apiClient = readFileSync(new URL('../lib/api-client.ts', import.meta.url), 'utf8');
const homeBannerUrl = new URL('../components/HomeBanner.tsx', import.meta.url);
const homeBanner = existsSync(homeBannerUrl) ? readFileSync(homeBannerUrl, 'utf8') : '';
const homePage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('api client exposes fetchHomeBanners hitting the banners endpoint', () => {
  assert.match(apiClient, /export async function fetchHomeBanners/);
  assert.match(apiClient, /\/api\/series\/banners/);
});

test('home banner renders a scroll-snap track with scaled cards', () => {
  assert.match(homeBanner, /home-banner-track/);
  assert.match(homeBanner, /scale\(/);
  assert.match(homeBanner, /function startAutoplay/);
  assert.match(homeBanner, /function stopAutoplay/);
});

test('home banner pauses autoplay on user interaction and resumes after a delay', () => {
  assert.match(homeBanner, /onPointerDown/);
  assert.match(homeBanner, /function scheduleResume/);
});

test('home banner renders nothing when there are no banners', () => {
  assert.match(homeBanner, /banners\.length === 0\) return null/);
});

test('single home banner uses a centered layout without peeking neighbors', () => {
  assert.match(homeBanner, /banners\.length === 1/);
  assert.match(globalStyles, /\.home-banner-track\.single/);
});

test('homepage renders HomeBanner in place of the static VIP promo card', () => {
  assert.match(homePage, /import HomeBanner from '@\/components\/HomeBanner'/);
  assert.match(homePage, /<HomeBanner \/>/);
  assert.doesNotMatch(homePage, /membership-card/);
});
