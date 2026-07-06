# 前端视觉重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web` 的 5 个页面套用 opendesign 导出的短剧 VOD 高保真原型（`vod-responsive-prototype-apple-polish-2.html`）的视觉系统，新增 1 个会员方案页，全部使用真实数据，不新增后端接口/schema。

**Architecture:** 新建 `apps/web/app/globals.css` 承载从原型迁移的 design tokens + 基础组件样式（深色消费端主题 + `.admin-shell` 浅色管理后台主题覆盖）。消费端共享 `TopBar`/`BottomNav` 两个客户端组件。每个页面改动局限在自己的 `page.tsx`，只重做 JSX 结构和 className，不改变现有的 fetch 调用模式（除了给 `api-client.ts` 补两处和真实后端已经返回、但之前没声明的字段/端点）。

**Tech Stack:** Next.js 14 App Router、React 18、纯 CSS（无 Tailwind/CSS Modules）、TypeScript strict。

**说明：** 本次是纯前端视觉改动，`apps/web` 目前没有测试框架（无 test 脚本、无测试文件），因此每个任务用 `tsc --noEmit` 类型检查 + `pnpm dev:web` 手动浏览器验证代替单元测试，不是省略验证，只是验证手段不同。CLAUDE.md 提到 `next dev`/`next build` 会自动往 `apps/web/tsconfig.json` 追加 `.next/types` 相关内容——每次验证后、提交前记得跑 `git checkout -- apps/web/tsconfig.json` 撤掉这个自动改动。

---

## 前置：确保能看到真实数据

执行任何任务前，先确认能拿到真实数据（否则页面永远是空态/加载态，没法判断视觉是否正确）：

```bash
pnpm dev:api    # 另开一个终端跑 apps/api（需要本地 PostgreSQL 已跑过 migrate + seed）
pnpm dev:web    # 再开一个终端跑 apps/web（默认 3000 端口，如被占用改用 next dev -p 3010）
```

浏览器打开 `http://localhost:3000`（或你用的端口），确认能看到（哪怕是丑的）剧集列表，再开始改视觉。

---

### Task 1: 补全 `api-client.ts` 的真实字段和端点

现有 `Series` 类型只声明了 `id/title/description/coverUrl`，但后端 `GET /api/series` 实际返回的是完整的 Prisma `Series` 行（包含 `freeEpisodeCount`/`unlockPriceCents`/`status`），首页卡片需要用这两个真实字段显示"前 N 集免费 / 解锁全集 NT$X"，而不是编造假数据。详情页也需要一个之前没被前端调用过、但后端已经实现的 `GET /api/series/:id` 端点来拿到 `freeEpisodeCount`（判断哪些集数要锁）。

**Files:**
- Modify: `apps/web/lib/api-client.ts`

- [ ] **Step 1: 扩展 `Series` 接口并新增 `fetchSeriesDetail`**

把 `apps/web/lib/api-client.ts` 整个文件内容替换为：

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export interface Series {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  freeEpisodeCount: number;
  unlockPriceCents: number;
}

export interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  durationSeconds: number | null;
}

export async function fetchSeriesList(): Promise<Series[]> {
  const res = await fetch(`${API_BASE_URL}/api/series`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load series');
  return res.json();
}

export async function fetchSeriesDetail(seriesId: string): Promise<Series> {
  const res = await fetch(`${API_BASE_URL}/api/series/${seriesId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load series detail');
  return res.json();
}

export async function fetchEpisodes(seriesId: string): Promise<Episode[]> {
  const res = await fetch(`${API_BASE_URL}/api/series/${seriesId}/episodes`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load episodes');
  return res.json();
}

export async function fetchPlaybackUrl(
  episodeId: string,
  token?: string
): Promise<{ url: string } | { locked: true }> {
  const res = await fetch(`${API_BASE_URL}/api/episodes/${episodeId}/playback`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (res.status === 403) return { locked: true };
  if (!res.ok) throw new Error('failed to load playback url');
  return res.json();
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 无输出（当前 `page.tsx`/`series/[id]/page.tsx` 还没用到新字段，不会报错）

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api-client.ts
git commit -m "feat(web): expose real freeEpisodeCount/unlockPriceCents and series-detail fetch"
```

---

### Task 2: 全局 design tokens 和基础样式

**Files:**
- Create: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: 创建 `apps/web/app/globals.css`**

```css
:root {
  --bg: #050506;
  --bg-elevated: #0b0b0d;
  --surface: rgba(255, 255, 255, 0.055);
  --surface-strong: rgba(255, 255, 255, 0.09);
  --fg: #f5f5f7;
  --fg-soft: #d7d7dc;
  --muted: #8e8e93;
  --muted-2: #636366;
  --border: rgba(255, 255, 255, 0.13);
  --border-soft: rgba(255, 255, 255, 0.08);
  --accent: #0a84ff;
  --accent-2: #64d2ff;
  --vip: #ffd76a;
  --danger: #ff453a;
  --success: #32d74b;

  --admin-bg: #f5f5f7;
  --admin-surface: #ffffff;
  --admin-fg: #1d1d1f;
  --admin-muted: #6e6e73;
  --admin-border: #dedee3;

  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-xl: 32px;

  --shadow-float: 0 30px 90px rgba(0, 0, 0, 0.42);

  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
}

* { box-sizing: border-box; }

html {
  color-scheme: dark;
  background: var(--bg);
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font-body);
  color: var(--fg);
  background:
    radial-gradient(circle at 50% -20%, rgba(255, 255, 255, 0.08), transparent 34rem),
    linear-gradient(180deg, #070708 0%, #050506 52%, #030304 100%);
  -webkit-font-smoothing: antialiased;
}

button, input, textarea, select { font: inherit; }
button { border: 0; cursor: pointer; background: none; color: inherit; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
  outline: 3px solid rgba(10, 132, 255, 0.72);
  outline-offset: 3px;
}
a { color: inherit; text-decoration: none; }
h1, h2, h3, p { margin: 0; }

.admin-shell {
  color-scheme: light;
  min-height: 100vh;
  color: var(--admin-fg);
  background: var(--admin-bg);
}

.primary-btn, .secondary-btn, .vip-btn, .admin-btn {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 999px;
  font-weight: 700;
  white-space: nowrap;
  transition: transform .18s ease, background .18s ease, opacity .18s ease;
}
.primary-btn:active, .secondary-btn:active, .vip-btn:active, .admin-btn:active { transform: scale(.98); }

.primary-btn { color: white; background: var(--accent); box-shadow: 0 14px 34px rgba(10,132,255,.32); }
.primary-btn:hover { background: #2b95ff; }
.primary-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }

.secondary-btn { color: var(--fg); border: 1px solid var(--border); background: var(--surface); }
.secondary-btn:hover { background: var(--surface-strong); }

.vip-btn { color: #2f2309; background: var(--vip); }
.vip-btn:hover { background: #ffe08a; }
.vip-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }

.admin-btn { color: var(--admin-fg); border: 1px solid var(--admin-border); background: var(--admin-surface); }
.admin-btn:hover { background: #f7f8fa; }
.admin-btn.admin-primary { color: white; background: var(--accent); border-color: transparent; }

.icon-btn, .avatar-btn {
  min-width: 44px;
  height: 44px;
  display: inline-grid;
  place-items: center;
  border-radius: 15px;
  color: var(--fg);
  border: 1px solid var(--border-soft);
  background: var(--surface);
}
.icon-btn:hover, .avatar-btn:hover { background: var(--surface-strong); }
.avatar-btn { width: 44px; font-weight: 800; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 70;
  height: 64px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-soft);
  background: rgba(5, 5, 6, .72);
  backdrop-filter: saturate(180%) blur(24px);
}
.brand { display: inline-flex; align-items: center; gap: 9px; font-family: var(--font-display); font-weight: 800; letter-spacing: -.02em; }
.brand-mark {
  width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; color: white;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}
.search-inline {
  min-width: 0; height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  border: 1px solid var(--border-soft); border-radius: 999px; color: var(--muted); background: var(--surface);
}
.search-inline input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--fg); background: transparent; }
.search-inline input::placeholder { color: var(--muted); }
.top-actions { display: inline-flex; align-items: center; gap: 8px; }

.user-menu {
  position: fixed; right: 12px; top: 70px; z-index: 90; display: none; width: min(300px, calc(100vw - 24px));
  padding: 10px; border: 1px solid var(--border); border-radius: 22px; background: rgba(20,20,22,.94);
  backdrop-filter: blur(18px); box-shadow: var(--shadow-float);
}
.user-menu.is-open { display: block; }
.menu-list { display: grid; gap: 6px; margin-top: 8px; }
.menu-list a {
  min-height: 44px; width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; border-radius: 14px; color: var(--fg); background: transparent; text-align: left;
}
.menu-list a:hover { background: var(--surface-strong); }

.home-page { max-width: 1200px; margin: 0 auto; padding: 20px 14px 96px; }
.home-intro { display: grid; gap: 6px; padding-bottom: 18px; }
.home-intro h1 { font-family: var(--font-display); font-size: clamp(26px, 7vw, 40px); letter-spacing: -.03em; }
.home-intro p { color: var(--muted); font-size: 14px; line-height: 1.5; }

.featured-row { display: grid; gap: 12px; margin-bottom: 20px; }
.membership-card {
  display: grid; gap: 14px; align-content: space-between; min-height: 180px; padding: 20px;
  border: 1px solid rgba(255,215,106,.28); border-radius: var(--radius-xl);
  background: radial-gradient(circle at 100% 0%, rgba(255,215,106,.22), transparent 18rem), var(--surface);
}
.eyebrow { display: inline-flex; align-items: center; gap: 7px; color: var(--accent-2); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.membership-card h2 { margin-top: 6px; font-family: var(--font-display); font-size: clamp(22px, 6vw, 30px); letter-spacing: -.03em; }
.membership-card p { margin-top: 8px; color: var(--fg-soft); line-height: 1.5; }

.section-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; margin: 8px 0 14px; }
.section-head h2 { font-family: var(--font-display); font-size: clamp(20px, 5vw, 28px); letter-spacing: -.02em; }
.view-status { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }

.video-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; min-height: 200px; }
.video-card {
  display: block; overflow: hidden; border: 1px solid var(--border-soft); border-radius: 19px;
  background: var(--bg-elevated); box-shadow: 0 10px 28px rgba(0,0,0,.18);
  transition: transform .2s ease, border-color .2s ease;
}
.video-card:hover { transform: translateY(-4px); border-color: rgba(10,132,255,.45); }
.thumb {
  position: relative; aspect-ratio: 16/10.5; overflow: hidden; background-size: cover; background-position: center;
  background-color: #171719;
  background-image: linear-gradient(135deg, rgba(10,132,255,.55), rgba(100,210,255,.35));
}
.thumb .tag {
  position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 800;
  color: #2f2309; background: var(--vip);
}
.video-body { padding: 14px; }
.video-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 40px; overflow: hidden; font-weight: 700; line-height: 1.3; }
.video-desc { margin-top: 6px; color: var(--muted); font-size: 13px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.video-meta { margin-top: 10px; color: var(--muted-2); font-size: 12px; }

.skeleton-card { min-height: 190px; border-radius: 19px; background: linear-gradient(90deg, var(--surface), var(--surface-strong), var(--surface)); background-size: 200% 100%; animation: loading 1.15s ease-in-out infinite; }
@keyframes loading { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.empty-state {
  grid-column: 1/-1; display: grid; place-items: center; min-height: 220px; padding: 24px; text-align: center;
  border: 1px solid var(--border-soft); border-radius: 22px; background: var(--surface);
}
.empty-state h3 { font-size: 18px; }
.empty-state p { margin-top: 8px; color: var(--muted); line-height: 1.5; }

.bottom-nav-wrap { position: fixed; left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); z-index: 70; }
.bottom-nav {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 7px; border: 1px solid var(--border);
  border-radius: 23px; background: rgba(10,10,12,.86); backdrop-filter: blur(20px); box-shadow: var(--shadow-float);
}
.bottom-nav a { min-height: 48px; display: grid; place-items: center; border-radius: 16px; color: var(--muted); font-size: 12px; font-weight: 700; }
.bottom-nav a.is-active { color: white; background: rgba(10,132,255,.22); }

.series-page { max-width: 1120px; margin: 0 auto; padding: 20px 14px 96px; }
.series-layout { display: grid; gap: 20px; }
.player-stage {
  position: relative; aspect-ratio: 9/16; max-height: 640px; margin: 0 auto; overflow: hidden;
  border: 1px solid var(--border-soft); border-radius: var(--radius-lg);
  background: linear-gradient(135deg, rgba(10,132,255,.5), var(--bg-elevated) 70%);
}
.player-stage video { width: 100%; height: 100%; object-fit: cover; display: block; }
.player-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: white; }
.player-big-play {
  width: 74px; height: 74px; display: grid; place-items: center; border-radius: 999px; color: white;
  background: rgba(255,255,255,.18); backdrop-filter: blur(12px); font-size: 24px;
}

.series-detail { display: grid; gap: 16px; }
.series-title-row h1 { margin-top: 8px; font-size: clamp(22px, 6vw, 30px); letter-spacing: -.03em; }
.series-desc { margin-top: 10px; color: var(--fg-soft); line-height: 1.6; }

.unlock-card {
  display: grid; gap: 12px; padding: 16px;
  border: 1px solid rgba(255,215,106,.3); border-radius: var(--radius-md); background: var(--surface);
}
.unlock-card strong { display: block; }
.unlock-card span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }

.episode-panel { display: grid; gap: 10px; }
.episode-head { display: flex; align-items: center; justify-content: space-between; }
.episode-head h3 { font-size: 16px; }
.episode-head span { color: var(--muted); font-size: 12px; font-family: var(--font-mono); }
.episode-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.episode-btn {
  min-height: 44px; border-radius: 12px; color: var(--fg); background: var(--surface); border: 1px solid var(--border-soft);
  font-weight: 700;
}
.episode-btn.is-active { color: white; background: var(--accent); border-color: var(--accent); }
.episode-btn.is-locked { color: var(--muted); background: var(--bg-elevated); }

.membership-page { max-width: 720px; margin: 0 auto; padding: 40px 14px 96px; display: grid; gap: 20px; }
.plan-card {
  padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface);
  display: grid; gap: 10px;
}
.plan-card strong { display: block; color: var(--vip); font-size: 36px; letter-spacing: -.03em; }
.plan-card span { color: var(--muted); font-size: 13px; }
.plan-note { color: var(--muted); font-size: 13px; text-align: center; }

.admin-main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 96px; }
.admin-header { display: grid; gap: 14px; margin-bottom: 20px; }
.admin-title h1 { font-size: clamp(24px, 6vw, 32px); letter-spacing: -.03em; }
.admin-title p { margin-top: 6px; color: var(--admin-muted); line-height: 1.5; }
.admin-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-bottom: 20px; }
.stat-card { padding: 16px; border: 1px solid var(--admin-border); border-radius: 18px; background: var(--admin-surface); }
.stat-card span { display: block; color: var(--admin-muted); font-size: 12px; font-weight: 700; }
.stat-card strong { display: block; margin-top: 8px; font-family: var(--font-mono); font-size: clamp(22px, 6vw, 30px); }

.panel { overflow: hidden; border: 1px solid var(--admin-border); border-radius: 20px; background: var(--admin-surface); margin-bottom: 16px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--admin-border); }
.panel-head h2 { font-size: 16px; }
.panel-head p { margin-top: 4px; color: var(--admin-muted); font-size: 13px; }

.table-wrap { overflow-x: auto; }
table { width: 100%; min-width: 620px; border-collapse: collapse; }
th, td { padding: 12px 16px; border-bottom: 1px solid var(--admin-border); text-align: left; font-size: 14px; }
th { color: var(--admin-muted); font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; background: #fbfcfe; }

.status { display: inline-flex; align-items: center; padding: 0 10px; height: 26px; border-radius: 999px; font-size: 12px; font-weight: 800; }
.status.published { color: #147045; background: rgba(22,163,74,.12); }
.status.draft { color: #9a5a00; background: rgba(245,158,11,.14); }

.form-grid { display: grid; gap: 12px; }
.field { display: grid; gap: 6px; }
.field label { font-size: 13px; font-weight: 700; }
.field input, .field textarea, .field select {
  width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--admin-border); border-radius: 12px;
  background: #fbfcfe; color: var(--admin-fg); outline: none;
}
.field textarea { min-height: 90px; padding-top: 10px; resize: vertical; }

.drawer-backdrop { position: fixed; inset: 0; z-index: 100; display: none; background: rgba(0,0,0,.5); }
.drawer-backdrop.is-open { display: block; }
.drawer-panel {
  position: fixed; inset: auto 0 0 0; z-index: 110; display: none; max-height: 88vh; overflow: auto; padding: 20px;
  border-radius: 24px 24px 0 0; background: var(--admin-surface); color: var(--admin-fg); box-shadow: 0 -24px 80px rgba(0,0,0,.28);
}
.drawer-panel.is-open { display: block; }
.drawer-head { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.close-btn { width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--admin-border); background: var(--admin-surface); color: var(--admin-fg); }

.login-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.login-card { width: min(360px, 100%); padding: 28px; border: 1px solid var(--admin-border); border-radius: var(--radius-xl); background: var(--admin-surface); display: grid; gap: 14px; }
.login-card h1 { font-size: 22px; }
.error-text { color: var(--danger); font-size: 13px; }

@media (min-width: 720px) {
  .home-page { padding: 28px 24px 96px; }
  .featured-row { grid-template-columns: minmax(280px, 1fr); max-width: 420px; }
  .video-grid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 18px; }
  .bottom-nav-wrap { display: none; }
  .series-layout { grid-template-columns: minmax(280px, 360px) 1fr; align-items: start; }
  .episode-grid { grid-template-columns: repeat(6, 1fr); }
  .admin-header { grid-template-columns: 1fr auto; align-items: end; }
  .stats-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .drawer-panel { inset: 0 0 0 auto; width: min(480px, 92vw); max-height: none; border-radius: 24px 0 0 24px; }
}

@media (min-width: 1080px) {
  .video-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```

- [ ] **Step 2: 在 layout 里引入全局样式**

把 `apps/web/app/layout.tsx` 整个文件内容替换为：

```tsx
import './globals.css';

export const metadata = {
  title: '短剧馆',
  description: '台湾短剧会员平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: 类型检查 + 启动验证**

```bash
cd apps/web && npx tsc --noEmit
pnpm dev:web
```

打开浏览器，首页应该是深色背景（原来的裸文字页面变成深色底、白字），说明全局样式生效了（此时页面结构还没改，后面几个任务会陆续把每页重做）。

- [ ] **Step 4: 撤销 tsconfig 自动改动 + Commit**

```bash
git checkout -- apps/web/tsconfig.json
git add apps/web/app/globals.css apps/web/app/layout.tsx
git commit -m "feat(web): add global design tokens and base styles from VOD prototype"
```

---

### Task 3: 共享 TopBar / BottomNav 组件

**Files:**
- Create: `apps/web/components/TopBar.tsx`
- Create: `apps/web/components/BottomNav.tsx`

- [ ] **Step 1: 创建 `apps/web/components/TopBar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';

interface TopBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export default function TopBar({ searchValue, onSearchChange }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="短剧馆首页">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M8.2 5.4v13.2L18.6 12 8.2 5.4Z" fill="currentColor" />
          </svg>
        </span>
        <span>短剧馆</span>
      </Link>

      {onSearchChange ? (
        <label className="search-inline">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="搜索短剧"
            aria-label="搜索短剧"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
      ) : (
        <span />
      )}

      <div className="top-actions">
        <button className="avatar-btn" onClick={() => setMenuOpen((open) => !open)} aria-label="打开用户菜单">
          我
        </button>
      </div>

      <aside className={`user-menu ${menuOpen ? 'is-open' : ''}`} aria-label="用户菜单">
        <div className="menu-list">
          <Link href="/membership" onClick={() => setMenuOpen(false)}>
            会员中心 <span>›</span>
          </Link>
          <Link href="/admin/login" onClick={() => setMenuOpen(false)}>
            管理员登录 <span>›</span>
          </Link>
        </div>
      </aside>
    </header>
  );
}
```

- [ ] **Step 2: 创建 `apps/web/components/BottomNav.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="bottom-nav-wrap">
      <nav className="bottom-nav" aria-label="移动端导航">
        <Link href="/" className={pathname === '/' ? 'is-active' : ''}>
          首页
        </Link>
        <Link href="/membership" className={pathname === '/membership' ? 'is-active' : ''}>
          会员
        </Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
```

Expected: 无输出（这两个组件还没被任何页面引用，不会报错；下一个任务开始使用它们）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/TopBar.tsx apps/web/components/BottomNav.tsx
git commit -m "feat(web): add shared TopBar and BottomNav components"
```

---

### Task 4: 首页重做

**Files:**
- Create: `apps/web/lib/format.ts`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: 创建 `apps/web/lib/format.ts`**

```ts
export function formatPriceCents(cents: number): string {
  return `NT$${Math.round(cents / 100)}`;
}
```

- [ ] **Step 2: 重写 `apps/web/app/page.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import { fetchSeriesList, Series } from '@/lib/api-client';
import { formatPriceCents } from '@/lib/format';

export default function HomePage() {
  const [seriesList, setSeriesList] = useState<Series[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchSeriesList().then(setSeriesList);
  }, []);

  const filtered = useMemo(() => {
    if (!seriesList) return [];
    const q = query.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter((s) => [s.title, s.description ?? ''].join(' ').toLowerCase().includes(q));
  }, [seriesList, query]);

  return (
    <>
      <TopBar searchValue={query} onSearchChange={setQuery} />
      <main className="home-page">
        <header className="home-intro">
          <h1>短剧馆</h1>
          <p>精选短剧持续上新，点开即看，前几集免费，会员解锁全集。</p>
        </header>

        <section className="featured-row">
          <article className="membership-card">
            <div>
              <div className="eyebrow">VIP</div>
              <h2>会员抢先看</h2>
              <p>解锁全集、无广告播放、高清画质。</p>
            </div>
            <Link href="/membership" className="vip-btn">
              开通会员
            </Link>
          </article>
        </section>

        <section className="section-head">
          <h2>正在流行</h2>
          {seriesList && <span className="view-status">{filtered.length} 部短剧</span>}
        </section>

        <section className="video-grid" aria-live="polite">
          {seriesList === null && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton-card" />)}

          {seriesList !== null && filtered.length === 0 && (
            <div className="empty-state">
              <div>
                <h3>{seriesList.length === 0 ? '暂无上架剧集' : '没有找到匹配短剧'}</h3>
                <p>{seriesList.length === 0 ? '内容马上就来，欢迎稍后再看看。' : '换个关键词试试。'}</p>
              </div>
            </div>
          )}

          {filtered.map((series) => (
            <Link key={series.id} href={`/series/${series.id}`} className="video-card">
              <div
                className="thumb"
                style={series.coverUrl ? { backgroundImage: `url(${series.coverUrl})` } : undefined}
              >
                <span className="tag">前 {series.freeEpisodeCount} 集免费</span>
              </div>
              <div className="video-body">
                <strong className="video-title">{series.title}</strong>
                {series.description && <p className="video-desc">{series.description}</p>}
                <div className="video-meta">解锁全集 {formatPriceCents(series.unlockPriceCents)}</div>
              </div>
            </Link>
          ))}
        </section>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 3: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

浏览器打开首页，检查：加载中显示骨架屏 → 加载完显示真实剧集卡片（标题/简介/免费集数/解锁价格）；在搜索框输入不存在的关键词能看到"没有找到匹配短剧"空态；点击卡片能跳到 `/series/[id]`；点右上角头像能弹出用户菜单。

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/format.ts apps/web/app/page.tsx
git commit -m "feat(web): redesign home page with VOD prototype visual system"
```

---

### Task 5: 剧集详情页重做

**Files:**
- Modify: `apps/web/app/series/[id]/page.tsx`

- [ ] **Step 1: 重写 `apps/web/app/series/[id]/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
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

  return (
    <>
      <TopBar />
      <main className="series-page">
        <div className="series-layout">
          <div className="player-stage">
            {playbackUrl ? (
              <video controls autoPlay src={playbackUrl} />
            ) : (
              <div className="player-placeholder">
                <span className="player-big-play" aria-hidden="true">
                  ▶
                </span>
              </div>
            )}
          </div>

          <div className="series-detail">
            <div className="series-title-row">
              <div className="eyebrow">短剧详情</div>
              <h1>{series?.title ?? '加载中…'}</h1>
              {series?.description && <p className="series-desc">{series.description}</p>}
            </div>

            {locked && (
              <div className="unlock-card">
                <div>
                  <strong>这一集需要解锁</strong>
                  <span>登录后可解锁全集或开通会员观看。</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secondary-btn" onClick={login}>
                    LINE 登录
                  </button>
                  <Link href="/membership" className="vip-btn">
                    去解锁
                  </Link>
                </div>
              </div>
            )}

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

- [ ] **Step 2: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

从首页点进任意一部短剧，检查：标题/简介正确显示；选集九宫格里超过 `freeEpisodeCount` 的集数显示"锁"；点击免费集数能播放（`fetchPlaybackUrl` 返回 url 时出现 `<video>`）；点击锁定集数出现"这一集需要解锁"提示，"LINE 登录"按钮能正常触发模拟登录，"去解锁"按钮跳到 `/membership`（下个任务会建好这个页面，现在先跳转到 404 是预期的，任务 6 之后就通了）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/series/\[id\]/page.tsx
git commit -m "feat(web): redesign series detail page with vertical player and episode grid"
```

---

### Task 6: 新建会员方案页 `/membership`

**Files:**
- Create: `apps/web/app/membership/page.tsx`

- [ ] **Step 1: 创建 `apps/web/app/membership/page.tsx`**

```tsx
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import { formatPriceCents } from '@/lib/format';

const MONTHLY_PLAN = {
  name: '月度会员',
  priceCents: 29900,
  description: '解锁全站短剧全集、无广告播放、高清画质，随时取消。',
};

export default function MembershipPage() {
  return (
    <>
      <TopBar />
      <main className="membership-page">
        <header className="home-intro">
          <h1>会员方案</h1>
          <p>选择适合你的会员方案，解锁全部短剧。</p>
        </header>

        <article className="plan-card">
          <div className="eyebrow">VIP</div>
          <h2>{MONTHLY_PLAN.name}</h2>
          <strong>{formatPriceCents(MONTHLY_PLAN.priceCents)} / 月</strong>
          <span>{MONTHLY_PLAN.description}</span>
          <button className="vip-btn" disabled title="会员支付功能即将开放">
            开通会员（即将开放）
          </button>
        </article>

        <p className="plan-note">需要单独解锁某部短剧？在该短剧详情页选择「去解锁」即可。</p>
        <p className="plan-note">
          <Link href="/">返回短剧馆</Link>
        </p>
      </main>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 2: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

打开 `/membership`，检查方案卡片显示正确的价格（NT$299/月）；"开通会员"按钮是禁用态（灰色、不可点）；从详情页锁定提示点"去解锁"能正确跳到这个页面。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/membership/page.tsx
git commit -m "feat(web): add membership plans display page"
```

---

### Task 7: 管理员登录页重做

**Files:**
- Modify: `apps/web/app/admin/login/page.tsx`

- [ ] **Step 1: 重写 `apps/web/app/admin/login/page.tsx`**

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError('登录失败');
      return;
    }
    const data = await res.json();
    localStorage.setItem('sd_admin_token', data.token);
    router.push('/admin');
  }

  return (
    <div className="admin-shell login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>管理员登录</h1>
        <div className="field">
          <label htmlFor="username">用户名</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-btn admin-primary" type="submit">
          登录
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

打开 `/admin/login`，检查浅色卡片居中显示；输错密码能看到红色错误提示；输入 `apps/api/prisma/seed.ts` 里的种子管理员账号密码能登录成功并跳到 `/admin`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/login/page.tsx
git commit -m "feat(web): restyle admin login page with light admin theme"
```

---

### Task 8: 管理后台首页重做

**Files:**
- Modify: `apps/web/app/admin/page.tsx`

- [ ] **Step 1: 重写 `apps/web/app/admin/page.tsx`**

```tsx
'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Series {
  id: string;
  title: string;
  status: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
}

function authHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function AdminDashboardPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [title, setTitle] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantSeriesId, setGrantSeriesId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function loadSeries() {
    const res = await fetch(`${API_BASE_URL}/api/admin/series`, { headers: authHeaders() });
    setSeriesList(await res.json());
  }

  useEffect(() => {
    loadSeries();
  }, []);

  async function createSeries(e: FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE_URL}/api/admin/series`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title }),
    });
    setTitle('');
    setDrawerOpen(false);
    loadSeries();
  }

  async function publishSeries(id: string) {
    await fetch(`${API_BASE_URL}/api/admin/series/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'published' }),
    });
    loadSeries();
  }

  async function grantSeriesUnlock(e: FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE_URL}/api/admin/grants/series-unlock`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: grantUserId, seriesId: grantSeriesId }),
    });
    alert('已解锁');
  }

  const publishedCount = seriesList.filter((s) => s.status === 'published').length;
  const draftCount = seriesList.length - publishedCount;

  return (
    <div className="admin-shell">
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-title">
            <h1>内容管理</h1>
            <p>上传 / 编辑短剧、维护上架状态。后台仅管理员登录后可见。</p>
          </div>
          <div className="admin-actions">
            <Link href="/" className="admin-btn">
              返回前台
            </Link>
            <button className="admin-btn admin-primary" onClick={() => setDrawerOpen(true)}>
              新建剧集
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card">
            <span>总剧集</span>
            <strong>{seriesList.length}</strong>
          </article>
          <article className="stat-card">
            <span>已上架</span>
            <strong>{publishedCount}</strong>
          </article>
          <article className="stat-card">
            <span>草稿</span>
            <strong>{draftCount}</strong>
          </article>
        </section>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>剧集列表</h2>
              <p>剧名、状态、免费集数、解锁价格。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>剧名</th>
                  <th>状态</th>
                  <th>免费集数</th>
                  <th>解锁价格</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {seriesList.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/admin/series/${s.id}`}>{s.title}</Link>
                    </td>
                    <td>
                      <span className={`status ${s.status === 'published' ? 'published' : 'draft'}`}>
                        {s.status === 'published' ? '已上架' : '草稿'}
                      </span>
                    </td>
                    <td>{s.freeEpisodeCount}</td>
                    <td>NT${(s.unlockPriceCents / 100).toFixed(0)}</td>
                    <td>
                      {s.status !== 'published' && (
                        <button className="admin-btn" onClick={() => publishSeries(s.id)}>
                          上架
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>手动开通剧集解锁</h2>
              <p>支付接入前的临时授予方式。</p>
            </div>
          </div>
          <form className="form-grid" style={{ padding: 16 }} onSubmit={grantSeriesUnlock}>
            <div className="field">
              <label htmlFor="grantUserId">User ID</label>
              <input id="grantUserId" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grantSeriesId">Series ID</label>
              <input id="grantSeriesId" value={grantSeriesId} onChange={(e) => setGrantSeriesId(e.target.value)} />
            </div>
            <button className="admin-btn admin-primary" type="submit">
              解锁
            </button>
          </form>
        </article>
      </main>

      <div className={`drawer-backdrop ${drawerOpen ? 'is-open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <section className={`drawer-panel ${drawerOpen ? 'is-open' : ''}`}>
        <div className="drawer-head">
          <h2>新建剧集</h2>
          <button className="close-btn" onClick={() => setDrawerOpen(false)} aria-label="关闭">
            ×
          </button>
        </div>
        <form className="form-grid" onSubmit={createSeries}>
          <div className="field">
            <label htmlFor="newTitle">剧名</label>
            <input id="newTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <button className="admin-btn admin-primary" type="submit">
            创建
          </button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

登录后打开 `/admin`，检查：统计卡片数字和列表条数一致；点"新建剧集"弹出底部/侧边抽屉，创建后抽屉关闭且表格刷新出新剧集；点"上架"后状态徽章变绿色"已上架"；"手动开通剧集解锁"表单填 User ID / Series ID 后点"解锁"弹出成功提示。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/page.tsx
git commit -m "feat(web): redesign admin dashboard with stats, table panel, and create-series drawer"
```

---

### Task 9: 集数管理页重做

**Files:**
- Modify: `apps/web/app/admin/series/[id]/page.tsx`

- [ ] **Step 1: 重写 `apps/web/app/admin/series/[id]/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  status: string;
}

function authHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function AdminSeriesEpisodesPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  async function load() {
    const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/episodes`, { headers: authHeaders() });
    setEpisodes(await res.json());
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function publish(id: string) {
    await fetch(`${API_BASE_URL}/api/admin/episodes/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'published' }),
    });
    load();
  }

  return (
    <div className="admin-shell">
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-title">
            <h1>集数管理</h1>
            <p>新增集数请用本地上传工具（tools/uploader）注册，这里只负责上下架。</p>
          </div>
          <div className="admin-actions">
            <Link href="/admin" className="admin-btn">
              返回剧集列表
            </Link>
          </div>
        </header>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>集数列表</h2>
              <p>集数、标题、状态与上架操作。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>集数</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((ep) => (
                  <tr key={ep.id}>
                    <td>第 {ep.episodeNumber} 集</td>
                    <td>{ep.title}</td>
                    <td>
                      <span className={`status ${ep.status === 'published' ? 'published' : 'draft'}`}>
                        {ep.status === 'published' ? '已上架' : '草稿'}
                      </span>
                    </td>
                    <td>
                      {ep.status !== 'published' && (
                        <button className="admin-btn" onClick={() => publish(ep.id)}>
                          上架
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 手动验证**

```bash
cd apps/web && npx tsc --noEmit
git checkout -- apps/web/tsconfig.json
pnpm dev:web
```

从 `/admin` 剧集列表点进任意剧名，检查集数表格正确显示，点"上架"后状态变绿色"已上架"，"返回剧集列表"能跳回 `/admin`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/series/\[id\]/page.tsx
git commit -m "feat(web): restyle episode management page with admin table panel"
```

---

### Task 10: 响应式验证 + 收尾

对照 DESIGN-MANIFEST.json 的 viewport 矩阵，在浏览器里逐一检查 5 个消费端/后台页面在窄屏和宽屏下没有横向滚动、卡片网格断点切换正常。

**Files:** 无新文件；如发现问题，修改 `apps/web/app/globals.css` 里对应的媒体查询规则。

- [ ] **Step 1: 移动端视口检查**

用浏览器 DevTools 切到 390×844（iPhone 标准尺寸）和 360×800（较窄安卓机型），逐页检查：首页卡片是 2 列、底部导航固定显示且不遮挡内容、详情页竖屏播放器不超出屏幕宽度、无横向滚动条。

- [ ] **Step 2: 平板/桌面视口检查**

切到 1024×768（平板横屏）和 1440×900（桌面），检查：首页卡片变 3-4 列、底部导航消失（`.bottom-nav-wrap` 在 `min-width: 720px` 时被隐藏）、详情页变两栏布局（播放器在左，选集在右）、后台管理页表格不被截断（有横向滚动容器兜底）。

- [ ] **Step 3: 如有问题，修复 `globals.css` 里的媒体查询并重新验证**

（这一步没有固定代码，取决于 Step 1/2 实际发现的问题；改完后重复 Step 1/2 直到通过。）

- [ ] **Step 4: 最终确认没有残留的 tsconfig 自动改动**

```bash
git status
```

Expected: `apps/web/tsconfig.json` 不出现在改动列表里（如果出现，运行 `git checkout -- apps/web/tsconfig.json`）。

- [ ] **Step 5: 如果 Step 3 有修复，Commit**

```bash
git add apps/web/app/globals.css
git commit -m "fix(web): adjust responsive breakpoints after viewport matrix check"
```

（如果 Step 1/2 全部通过、没有改动，跳过这个 commit。）

---

## 自查记录

- **spec 覆盖检查**：globals.css/tokens（Task 2）、首页（Task 4）、详情页（Task 5）、会员页（Task 6）、管理后台三页（Task 7/8/9）、数据保真度调整（Task 1 补字段 + Task 4/8 去掉假数据字段）、响应式验证（Task 10）——spec 里的每一节都有对应任务。
- **占位符检查**：全文没有 TBD/TODO，每个 Step 都有完整代码或精确到具体检查项的验证说明。
- **类型一致性检查**：`Series`/`Episode` 接口在 `api-client.ts`（Task 1）定义后，Task 4/5 的页面代码字段名（`freeEpisodeCount`/`unlockPriceCents`/`episodeNumber`）全部对得上；`fetchSeriesDetail`/`fetchPlaybackUrl`/`fetchEpisodes` 函数名在各任务里保持一致。
