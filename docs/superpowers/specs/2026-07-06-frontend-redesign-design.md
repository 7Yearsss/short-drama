# 前端重构设计：套用 VOD 短剧设计稿

## 背景

用户在 opendesign 上导出了一套短剧 VOD 网站的高保真原型（4 个 HTML 文件 + DESIGN-HANDOFF.md + DESIGN-MANIFEST.json，位于 `E:\REPORT\Web-Prototype\`）。其中 `vod-responsive-prototype-apple-polish-2.html`（标题「影栈 — 短剧视频点播原型」）是唯一一个针对短剧场景（而非通用 VOD）设计的版本，视觉最完整、和当前项目的域模型（剧集 Series + 集数 Episode + 会员解锁）最贴近，作为本次重构的参照基准。

当前 `apps/web` 是 Next.js App Router 项目，5 个页面全部是裸内联样式的功能性占位（无 CSS 框架、无 globals.css），已经跑通真实的 series/episodes/playback/admin API 调用。这次任务只重做视觉层，不改动现有的数据请求逻辑。

## 目标

把 `apps/web` 的 5 个页面套上原型的视觉系统（深色消费端 + 浅色管理后台的 Apple 风格），同时保持现有真实数据流不变。

## 范围内

- `apps/web/app/globals.css`：迁移原型的 design tokens（颜色变量、圆角、阴影、字体栈）和基础组件样式（按钮、chip、card、table、表单控件）。
- `/` 首页重做视觉，套用原型 featured-row + 卡片网格结构。
- `/series/[id]` 详情页重做视觉，照抄原型 series-modal 的布局（竖屏播放区 + 选集九宫格），但保持独立路由不变。
- 新增 `/membership` 会员方案展示页（纯静态展示，无支付）。
- `/admin/login`、`/admin`、`/admin/series/[id]` 三个后台页面套用原型的浅色管理后台视觉。
- 所有页面响应式行为参照 DESIGN-MANIFEST.json 里的 viewport 矩阵（360×800 到 1920×1080），不出现横向滚动。

## 范围外 / 不做

- 不新增后端接口或 schema 字段。
- 不做真实支付接入（仍是待办事项，见 CLAUDE.md）。
- 不做观看历史/进度持久化。
- 不做剧集分类/标签体系。

## 数据保真度调整（原型 vs 真实 schema 的差异处理）

原型用的是虚构数据（genre 分类、播放量、VIP 标记、"继续观看"进度、7 日播放趋势图），真实 schema（`apps/api/prisma/schema.prisma`）里没有这些字段。处理方式：

| 原型元素 | 真实 schema 支撑情况 | 处理方式 |
|---|---|---|
| 分类 chips（全部/热门/都市…） | Series 无 category/genre 字段 | 去掉，只保留顶部搜索框做客户端标题搜索 |
| "继续观看"卡片（含播放进度） | 无观看历史/进度表 | 去掉；首屏用简单介绍条 + 会员推广卡（featured-row 只保留会员卡一侧） |
| 卡片上的 VIP/HOT 假标签 | 无对应字段 | 用 `freeEpisodeCount`/`unlockPriceCents` 派生出的真实标签替代，例如"前 2 集免费 · NT$99 解锁全集" |
| 选集九宫格里集数的锁定态 | 有 `freeEpisodeCount`，真正解锁判断走现有 403 逻辑 | 视觉上按 `episodeNumber > freeEpisodeCount` 显示锁形态，实际播放仍走现有 `fetchPlaybackUrl` 403 判断，不改逻辑 |
| 后台播放量 / 会员转化率 / 7日播放趋势图 | 无播放统计后端 | 去掉，只展示能从真实数据算出的统计：总剧集数、已上架数、草稿数 |
| 会员方案页数据来源 | 无公开的会员方案查询接口 | `/membership` 用已知种子数据（月度 NT$299）静态渲染，不发请求 |

## 各页面设计

### 全局：`apps/web/app/globals.css` + `layout.tsx`

- 从 `vod-responsive-prototype-apple-polish-2.html` 的 `<style>` 中提取：
  - 颜色变量：`--bg --bg-elevated --surface --surface-strong --fg --fg-soft --muted --border --accent --accent-2 --vip --danger --success --warning`，以及浅色管理后台变量 `--admin-bg --admin-surface --admin-fg --admin-muted --admin-border`
  - 圆角：`--radius-sm/md/lg/xl`
  - 阴影：`--shadow-float --shadow-soft`
  - 字体栈：`--font-display --font-body --font-mono`
  - 基础样式：`button/input/select/textarea` reset、`:focus-visible` outline、`.primary-btn/.secondary-btn/.vip-btn/.admin-btn`、`.chip`、`.icon-btn/.avatar-btn`
- `body` 默认深色背景（径向渐变，同原型）；`body.is-admin-view` 切换到浅色管理后台配色（在 `/admin/*` 路由的顶层容器上加这个 class）。
- `app/layout.tsx` 引入 `./globals.css`。

### `/` 首页

结构参照原型 `#home`：
- **Topbar**：品牌 logo + 搜索框（真实：客户端过滤当前已加载的 series 列表，按 title/description 关键词）+ 头像按钮（点击展开用户菜单：会员中心链接、管理员入口占位）。
- **Featured row**：只保留右侧会员推广卡（"会员抢先看"，按钮跳转 `/membership`），左侧"继续观看"卡片去掉，替换成简短的介绍条（标题 + 一句话说明，纯静态文案）。
- **视频网格**：`fetchSeriesList()` 拿到的真实数据渲染卡片。每张卡片：封面（`coverUrl` 或原型风格的装饰性渐变占位）、标题、`description` 截断两行、`freeEpisodeCount`/`unlockPriceCents` 派生标签、点击跳转 `/series/[id]`。
- 加载态用原型的 skeleton-grid 骨架屏；空态用原型的 empty-state 结构（无搜索结果 / 暂无上架剧集两种文案）。
- 移动端保留原型的底部导航（首页/搜索/会员），去掉"管理"入口（管理员走独立登录入口，不在移动端底部导航暴露）。

### `/series/[id]` 详情页

保持现有路由和数据请求逻辑（`fetchEpisodes` + `fetchPlaybackUrl` + LIFF 登录）不变，只重做视觉，照抄原型 `.series-layout`（两栏：播放区 + 详情面板）：
- 左侧播放区：真实 `<video>` 元素（`playbackUrl` 有值时展示），未播放/锁定时展示原型风格的播放器占位（大播放按钮 + 渐变背景）。
- 右侧详情面板：剧名、`description`、选集九宫格（`episode-grid`，用真实 `episodes` 数组渲染，集数按钮态：可播放 / 当前播放中 / 锁定态）、锁定时展示解锁提示 + 跳转 `/membership` 的按钮（沿用原型 "next-card" 视觉位置放"需要登录/解锁"提示，替代原型的"下一集"文案）。
- 保持现有的 LINE 登录模拟按钮（锁定时展示），只重新套样式，不改行为。

### `/membership` 会员方案页（新建）

- 纯展示页，无数据请求。用原型的 `plan-card` 视觉渲染一张卡片：会员名称（"月度会员"）、价格（NT$299/月，来自已知种子数据硬编码）、简介文案。
- "开通会员"按钮点击后展示一个提示（可以是简单的文字提示或者禁用态 + tooltip，不做真实支付跳转），文案类似"会员支付功能即将开放"。

### `/admin/login`

- 复用管理后台浅色卡片视觉重做现有表单（用户名/密码/登录按钮/错误提示），行为不变（`POST /api/admin/login` 存 token 到 localStorage，跳转 `/admin`）。

### `/admin` 后台首页

- 顶部：标题 + 操作按钮（返回前台链接到 `/`、创建剧集表单沿用原型的 upload-drawer 视觉，用弹出 drawer 承载现有的"新建剧集"表单）。
- **统计卡片**（只保留真实可推导的三项）：总剧集数、已上架数、草稿数（都从 `fetchSeries()` 结果 client-side 计算，不新增接口）。
- **剧集表格面板**：沿用原型 `.panel` + `table` 样式，字段：剧名、状态（published/draft 徽章）、免费集数、解锁价格、操作（上架按钮 / 进入集数管理链接）。
- 去掉原型的分类管理面板和 7 日播放趋势图（无对应数据）。
- "手动开通剧集解锁"表单保留，套用原型的 `.field` 表单样式，作为页面内的一个 panel。

### `/admin/series/[id]` 集数管理页

- 沿用管理后台 `.panel` + `table` 视觉，展示该剧集下的集数列表（集数、标题、状态徽章、上架操作按钮），行为不变（现有的 PATCH 上架请求）。
- 保留"新增集数请用本地上传工具"的提示文案，视觉上放进 panel 的说明区。

## 响应式

按 DESIGN-MANIFEST.json 的 viewport 矩阵验证：360×800 / 390×844 / 430×932 / 600×960 / 820×1180 / 1024×768 / 1366×768 / 1440×900 / 1920×1080，参照原型已有的媒体查询断点（720px / 1080px / 1440px / max-420px），确保无横向滚动。

## 验证方式

用 dev server 在浏览器里过一遍：首页加载态/空态/正常列表、搜索过滤、详情页播放/锁定态切换、会员页展示、后台三个页面的核心操作（登录、创建剧集、上架、集数管理），并在移动/桌面两种视口下截图确认无布局问题。
