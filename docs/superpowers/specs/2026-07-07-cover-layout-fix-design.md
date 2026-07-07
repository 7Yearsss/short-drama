# 首页/详情页封面展示与布局微调 — 设计文档

日期:2026-07-07

## 背景

短剧封面图是竖版海报(人像 + 大标题文字,类似 `分手三年我刷了他37万` 的示例图)。当前实现有三处观感问题:

1. 首页网格卡片 `.thumb`(`apps/web/app/globals.css`)用 `aspect-ratio: 16/10.5` 横向裁剪 + `background-size: cover`,竖版海报被裁得只剩中间一小条,标题文字和构图都被切掉。
2. 详情页 `.player-stage` 在播放前只显示一个装饰性渐变 + 大播放按钮(`apps/web/app/series/[id]/page.tsx` 的 `.player-placeholder`),完全没用到该剧封面图,进入详情页第一眼很空。
3. 详情页右侧内容区(`.series-detail`)在集数很少(如目前的示例剧只有 1 集)时,标题/简介/选集区域挤在顶部,下方大片空白,`.episode-grid` 用 `repeat(5,1fr)` 把仅有的 1-2 个按钮拉伸铺满整行,显得不自然。

## 改动范围

纯前端 CSS + 少量 JSX 调整,不涉及 API、数据库、类型定义改动。

## 改动 1:首页卡片封面改竖版

`apps/web/app/globals.css`:

- `.thumb` 的 `aspect-ratio` 从 `16/10.5` 改为 `2/3`,`background-size: cover; background-position: center` 保持不变(竖版比例下海报基本能完整展示,不会切到底部标题文字)。
- `.skeleton-card` 的 `min-height` 相应调大,和竖版卡片撑起的高度匹配,避免加载态和真实态之间的布局跳动。
- 网格列数不变:移动端 2 列(`.video-grid`)、`≥720px` 3 列、`≥1080px` 4 列。列数不变 + 卡片变高是本次唯一影响布局密度的因素,属于用户已确认的最小改动选项。

## 改动 2:详情页播放前用封面做占位背景

`apps/web/app/series/[id]/page.tsx`:

- `.player-placeholder` 增加内联 `backgroundImage`(取 `series.coverUrl`,和首页 `.thumb` 用同一字段),让播放前的占位区域直接显示该剧封面,而不是纯装饰渐变。
- 给 `.player-big-play` 按钮包一层可点击的容器,点击时触发播放**第一集**(`episodes[0]`),复用已有的 `play()` 函数,不新增状态字段。若 `episodes` 尚未加载完成(为空数组),点击无效果(按钮仍可见,只是暂不触发播放)。

`apps/web/app/globals.css`:

- `.player-placeholder` 增加 `background-size: cover; background-position: center`,并叠加一层半透明深色遮罩(如 `background: linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55))` 或用 `::before` 伪元素),保证播放按钮在任意封面图上都清晰可辨识,不会被浅色封面"吃掉"。

## 改动 3:详情页布局间距微调(不新增内容区块)

`apps/web/app/globals.css`:

- `.series-detail` 改为 `display: flex; flex-direction: column;`(替代当前的 `display: grid; gap: 16px`),配合 `.episode-panel` 加 `margin-top: auto`(或等效的 flex 间距调整),让选集区域在内容(标题/简介/解锁提示)较少时不会紧贴文字堆在顶部,而是合理地把剩余空间分布开,避免右侧/下方出现一大块死白。
- `.episode-grid` 从固定 `grid-template-columns: repeat(5, 1fr)` 改为按钮宽度固定(如 `grid-template-columns: repeat(auto-fill, minmax(44px, 44px))`)+ `justify-content: start`,这样集数很少时(比如只有 1-2 集)按钮保持自身尺寸紧凑排列,不会被拉伸铺满整行。

本次不引入新的数据字段、新的 UI 区块(如标签、相关推荐),严格限定在裁剪比例、占位背景、间距对齐三处。

## 验证方式

本地起 `apps/web` dev server,用现有的"分手三年我刷了他37万"示例剧数据(已有 `coverUrl`)分别检查:

- 首页网格卡片封面是否完整展示海报构图和标题文字
- 详情页进入后播放前是否显示封面背景 + 播放按钮,点击后是否正确播放第一集
- 详情页(尤其只有 1 集时)整体布局是否不再有大片空白、选集按钮不再被异常拉伸
