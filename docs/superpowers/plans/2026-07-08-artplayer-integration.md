# ArtPlayer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `<video>` element on the series detail page with ArtPlayer, move the "locked episode" prompt from a separate card into the player box itself, and add a user-toggleable auto-next-episode behavior.

**Architecture:** A new `PlayerStage` client component owns a single ArtPlayer instance and renders three states — idle (poster + play button), locked (poster + unlock prompt), playing (real ArtPlayer with a custom "auto-next" setting toggle). `apps/web/app/series/[id]/page.tsx` is reduced to passing state and callbacks into `PlayerStage`; it does not know ArtPlayer exists.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript (strict), ArtPlayer (`artplayer` npm package, latest — pin whatever `pnpm add` resolves, no version floor required).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-artplayer-integration-design.md` — read it before starting, this plan implements it exactly.
- Still plays a single MP4 signed URL from `apps/api/src/routes/playback.ts` — **do not** touch backend playback/auth logic.
- Do **not** add `hls.js` or `artplayer-plugin-hls-control` — no HLS/multi-quality in this change.
- No new automated tests — ArtPlayer is a heavy DOM/Canvas library and the approved spec explicitly scopes this to manual verification only (see Task 2, Step 4).
- Before committing anything, run `git status` on `apps/web/tsconfig.json` — running `next dev`/`next build` auto-injects a `.next/types` include and a `next` plugin entry into it (a known repo quirk, documented in the root `CLAUDE.md`). If it shows as modified and you didn't intend to change it, run `git checkout -- apps/web/tsconfig.json` before staging.
- Package manager is pnpm workspaces; the web app's package name is `web` (see `apps/web/package.json`), so scope commands with `pnpm --filter web ...`.

## Deviation from the design doc's exact wording (read this before Task 1)

The spec says the locked state uses an ArtPlayer `layers.add()` overlay. While researching the ArtPlayer API (`artplayer.d.ts` type definitions, confirmed against the GitHub repo) it turns out the `Option.url` field required to construct an `Artplayer` instance is a non-optional `string` — there is no supported way to construct an instance with "no video yet", which is exactly the idle and locked states (no playback URL exists until the backend returns one).

To keep the same **user-visible outcome** the spec asked for (no separate card below the player; the lock prompt lives inside the same rounded player box) without relying on undefined behavior, this plan only constructs the real ArtPlayer instance once a `playbackUrl` exists. The idle and locked states are rendered as plain React markup inside the *same* `.player-stage` container (reusing the existing `.player-placeholder` / `.player-play-trigger` / `.player-big-play` / `.unlock-card` classes, just relocated) instead of ArtPlayer `layers`. Visually and structurally this is identical to what was approved; the only change is which mechanism draws it. If you are the executor and think this is wrong, stop and ask — don't silently switch to a different approach.

---

### Task 1: Add ArtPlayer dependency and create the `PlayerStage` component

**Files:**
- Modify: `apps/web/package.json` (adds `artplayer` dependency via `pnpm add`, don't hand-edit)
- Create: `apps/web/components/PlayerStage.tsx`

**Interfaces:**
- Produces: `PlayerStage` React component, default export from `apps/web/components/PlayerStage.tsx`, with props:
  ```ts
  interface PlayerStageProps {
    coverUrl: string | null;
    playbackUrl: string | null; // null = not yet playing or locked
    locked: boolean;
    onRequestPlay: () => void;  // idle state, big play button clicked
    onRequestLogin: () => void; // locked state, "LINE 登录" clicked
    onEnded: () => void;        // playback finished + auto-next enabled
  }
  ```
  Task 2 consumes this component and this exact prop shape.

- [ ] **Step 1: Install the dependency**

Run:
```bash
pnpm --filter web add artplayer
```
Expected: `apps/web/package.json` gains an `"artplayer": "^5.x.x"` line under `dependencies`, and the lockfile updates. Confirm with:
```bash
grep -n "artplayer" apps/web/package.json
```
Expected output: one line like `"artplayer": "^5.4.0",`.

- [ ] **Step 2: Create the component**

Create `apps/web/components/PlayerStage.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Artplayer from 'artplayer';

const AUTO_NEXT_STORAGE_KEY = 'autoNextEpisode';

function getAutoNextPref(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
}

function setAutoNextPref(value: boolean): void {
  window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(value));
}

interface PlayerStageProps {
  coverUrl: string | null;
  playbackUrl: string | null;
  locked: boolean;
  onRequestPlay: () => void;
  onRequestLogin: () => void;
  onEnded: () => void;
}

export default function PlayerStage({
  coverUrl,
  playbackUrl,
  locked,
  onRequestPlay,
  onRequestLogin,
  onEnded,
}: PlayerStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!playbackUrl || !containerRef.current) {
      return;
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: playbackUrl,
      poster: coverUrl ?? '',
      autoplay: true,
      autoSize: false,
      fullscreen: true,
      setting: true,
      settings: [
        {
          name: 'autoNext',
          html: '自动连播',
          switch: getAutoNextPref(),
          onSwitch(item) {
            const next = !item.switch;
            setAutoNextPref(next);
            item.switch = next;
            return next;
          },
        },
      ],
    });

    art.on('video:ended', () => {
      if (getAutoNextPref()) {
        onEndedRef.current();
      }
    });

    return () => {
      art.destroy(false);
    };
  }, [playbackUrl, coverUrl]);

  if (playbackUrl) {
    return <div className="player-stage" ref={containerRef} />;
  }

  return (
    <div
      className="player-stage player-placeholder"
      style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
    >
      {locked ? (
        <div className="unlock-card">
          <div>
            <strong>这一集需要解锁</strong>
            <span>登录后可解锁全集或开通会员观看。</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary-btn" onClick={onRequestLogin}>
              LINE 登录
            </button>
            <Link href="/membership" className="vip-btn">
              去解锁
            </Link>
          </div>
        </div>
      ) : (
        <button className="player-play-trigger" onClick={onRequestPlay} aria-label="播放第一集">
          <span className="player-big-play" aria-hidden="true">
            ▶
          </span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors. If `artplayer` ships its own types (it does, as a `.d.ts` bundled with the npm package), this should resolve cleanly with `esModuleInterop: true` (already set in `apps/web/tsconfig.json`).

If `git status apps/web/tsconfig.json` now shows it modified and you didn't edit it, that's the known Next.js auto-inject quirk — run `git checkout -- apps/web/tsconfig.json` before the next step.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/PlayerStage.tsx
git commit -m "feat(web): add ArtPlayer-based PlayerStage component"
```
(The workspace lockfile lives at the repo root, not inside `apps/web/`.)

---

### Task 2: Wire `PlayerStage` into the series detail page and clean up styles

**Files:**
- Modify: `apps/web/app/series/[id]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `PlayerStage` component and `PlayerStageProps` from Task 1 (`apps/web/components/PlayerStage.tsx`).

- [ ] **Step 1: Replace the player markup in `page.tsx`**

Read the current file first: `apps/web/app/series/[id]/page.tsx`. Replace its entire contents with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import PlayerStage from '@/components/PlayerStage';
import { fetchEpisodes, fetchPlaybackUrl, fetchSeriesDetail, Episode, Series } from '@/lib/api-client';
import { getStoredToken, mockLineLogin } from '@/lib/liff-mock';

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetchSeriesDetail(params.id).then(setSeries);
    fetchEpisodes(params.id).then(setEpisodes);
  }, [params.id]);

  async function play(episode: Episode) {
    setActiveEpisodeId(episode.id);
    setLocked(false);
    setPlaybackUrl(null);
    const token = getStoredToken() ?? undefined;
    const result = await fetchPlaybackUrl(episode.id, token);
    if ('locked' in result) {
      setLocked(true);
      return;
    }
    setPlaybackUrl(result.url);
  }

  async function login() {
    await mockLineLogin();
  }

  const freeEpisodeCount = series?.freeEpisodeCount ?? 0;
  const firstEpisode = episodes[0];
  const activeIndex = episodes.findIndex((episode) => episode.id === activeEpisodeId);
  const nextEpisode = activeIndex >= 0 ? episodes[activeIndex + 1] : undefined;

  return (
    <>
      <TopBar />
      <main className="series-page">
        <div className="series-layout">
          <PlayerStage
            coverUrl={series?.coverUrl ?? null}
            playbackUrl={playbackUrl}
            locked={locked}
            onRequestPlay={() => firstEpisode && play(firstEpisode)}
            onRequestLogin={login}
            onEnded={() => nextEpisode && play(nextEpisode)}
          />

          <div className="series-detail">
            <div className="series-title-row">
              <div className="eyebrow">短剧详情</div>
              <h1>{series?.title ?? '加载中…'}</h1>
              {series?.description && <p className="series-desc">{series.description}</p>}
            </div>

            <section className="episode-panel">
              <div className="episode-head">
                <h3>选集</h3>
                <span>共 {episodes.length} 集</span>
              </div>
              <div className="episode-grid">
                {episodes.map((episode) => (
                  <button
                    key={episode.id}
                    className={`episode-btn ${episode.id === activeEpisodeId ? 'is-active' : ''} ${
                      episode.episodeNumber > freeEpisodeCount ? 'is-locked' : ''
                    }`}
                    onClick={() => play(episode)}
                  >
                    {episode.episodeNumber > freeEpisodeCount ? '锁' : episode.episodeNumber}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
```

This removes the inline `<video>`, the inline placeholder JSX, and the standalone `{locked && (...)}` unlock-card block — all three are now inside `PlayerStage`. It also drops the `Link` import (moved into `PlayerStage.tsx`) and adds `nextEpisode` lookup for the auto-next callback.

- [ ] **Step 2: Add the nested unlock-card CSS rule**

Open `apps/web/app/globals.css` and find the existing `.unlock-card` block (around line 239):

```css
.unlock-card {
  display: grid; gap: 12px; padding: 16px;
  border: 1px solid rgba(255,215,106,.3); border-radius: var(--radius-md); background: var(--surface);
}
.unlock-card strong { display: block; }
.unlock-card span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }
```

Immediately after that block, add:

```css
.player-placeholder .unlock-card { position: relative; z-index: 1; width: min(100%, 280px); }
```

Do not remove any other existing rules (`.player-stage`, `.player-stage video`, `.player-placeholder`, `.player-placeholder::before`, `.player-play-trigger`, `.player-big-play` are all still used, unchanged, by `PlayerStage.tsx`).

- [ ] **Step 3: Type-check**

Run:
```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

If `apps/web/tsconfig.json` shows as modified in `git status` from the auto-inject quirk, run `git checkout -- apps/web/tsconfig.json` before committing.

- [ ] **Step 4: Manual verification in the browser**

Start the dev server (port 3000 may be busy — see root `CLAUDE.md`; pass a different port if needed):
```bash
pnpm --filter web dev
# or, if 3000 is taken:
pnpm --filter web dev -- -p 3010
```

Also start the API if it isn't already running (`pnpm dev:api`), since the page needs it for series/episode/playback data.

Open a series detail page (`/series/<id>` for a seeded series) in a browser and confirm all of the following:

1. Tapping the cover's big play button starts playback of the first episode inside the ArtPlayer UI (controls, fullscreen button, settings gear all visible).
2. Switching to a locked episode number (one past `freeEpisodeCount`) shows the "这一集需要解锁" prompt with "LINE 登录" and "去解锁" buttons **inside the rounded player box** — there is no separate card below it anymore.
3. Clicking "LINE 登录" triggers the existing mock login flow (no crash, same behavior as before this change).
4. Open the settings gear on a playing episode — a "自动连播" switch item appears, defaulting on.
5. Let an unlocked episode play to the end with "自动连播" on: the next episode starts automatically (or, if the next episode is locked, the locked prompt appears inside the player instead of a blank/black screen).
6. Turn "自动连播" off, let an episode finish: playback stops on the ended frame and nothing auto-advances. Reload the page and confirm the switch is remembered (still off) — it's persisted to `localStorage`.

If any check fails, fix `PlayerStage.tsx` or `page.tsx` and re-verify before moving on — do not commit a broken state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/series/[id]/page.tsx apps/web/app/globals.css
git commit -m "feat(web): use ArtPlayer with in-player lock prompt and auto-next toggle"
```

---

## Post-plan note for whoever executes this

This plan was written to be handed to a different AI/agent for execution. Before starting, that executor should:
1. Read `docs/superpowers/specs/2026-07-08-artplayer-integration-design.md` for the full rationale.
2. Read the "Deviation from the design doc's exact wording" section above — it explains a real API constraint discovered while writing this plan (ArtPlayer requires a non-empty `url` at construction time), not a shortcut.
3. Confirm the `apps/web/app/series/[id]/page.tsx` and `apps/web/app/globals.css` git diffs shown as "M" in the original `git status` (unrelated in-progress local changes) don't conflict with the edits in Task 2 — if they do, stop and ask rather than overwriting someone else's in-progress work.
