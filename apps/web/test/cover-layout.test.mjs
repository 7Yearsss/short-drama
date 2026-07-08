import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/series/[id]/page.tsx', import.meta.url), 'utf8');
const playerStage = readFileSync(new URL('../components/PlayerStage.tsx', import.meta.url), 'utf8');

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  assert.ok(match?.groups?.body, `Missing CSS rule for ${selector}`);
  return match.groups.body;
}

test('home cover cards use a portrait poster ratio', () => {
  const thumb = ruleFor('.thumb');

  assert.match(thumb, /aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(thumb, /background-size:\s*cover/);
  assert.match(thumb, /background-position:\s*center/);
});

test('home loading skeleton is tall enough for portrait cards', () => {
  const skeleton = ruleFor('.skeleton-card');

  assert.match(skeleton, /min-height:\s*clamp\(340px,\s*54vw,\s*520px\)/);
});

test('detail placeholder uses cover art and can start the first episode', () => {
  assert.match(detailPage, /const firstEpisode = episodes\[0\];/);
  assert.match(detailPage, /<PlayerStage/);
  assert.match(detailPage, /coverUrl=\{series\?\.coverUrl \?\? null\}/);
  assert.match(detailPage, /onRequestPlay=\{\(\) => firstEpisode && play\(firstEpisode\)\}/);
  assert.match(playerStage, /style=\{coverUrl \? \{ backgroundImage: `url\(\$\{coverUrl\}\)` \} : undefined\}/);
  assert.match(playerStage, /aria-label="\u64ad\u653e\u7b2c\u4e00\u96c6"/);
});

test('detail player stage has an explicit width for absolute placeholders', () => {
  const stage = ruleFor('.player-stage');

  assert.match(stage, /width:\s*min\(100%,\s*360px\)/);
});

test('detail placeholder has cover sizing and a readable overlay', () => {
  const placeholder = ruleFor('.player-placeholder');
  const overlay = ruleFor('.player-placeholder::before');

  assert.match(placeholder, /background-size:\s*cover/);
  assert.match(placeholder, /background-position:\s*center/);
  assert.match(overlay, /background:\s*linear-gradient\(180deg,\s*rgba\(0,0,0,\.35\),\s*rgba\(0,0,0,\.58\)\)/);
});

test('artplayer video uses contain so desktop fullscreen does not crop vertical content', () => {
  const artVideo = ruleFor('.player-stage .art-video');

  assert.match(artVideo, /object-fit:\s*contain/);
});

test('detail layout uses flex spacing and compact episode buttons', () => {
  const detail = ruleFor('.series-detail');
  const panel = ruleFor('.episode-panel');
  const grid = ruleFor('.episode-grid');

  assert.match(detail, /display:\s*flex/);
  assert.match(detail, /flex-direction:\s*column/);
  assert.match(panel, /margin-top:\s*auto/);
  assert.match(grid, /grid-template-columns:\s*repeat\(auto-fill,\s*44px\)/);
  assert.match(grid, /justify-content:\s*start/);
});
