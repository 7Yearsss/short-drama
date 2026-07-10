# 首页热播 Banner 轮播 — 设计文档

日期:2026-07-10

## 背景

首页目前没有任何"热播/推荐位"概念:`Series` 表没有相关字段,首页顶部只有一张写死的 VIP 会员推广卡片(`apps/web/app/page.tsx` 的 `.featured-row` / `.membership-card`),管理后台也没有任何控件能让运营选择/排序首页展示哪些剧。本设计新增一个可由管理后台配置的首页 Banner 轮播,替换掉现有的 VIP 推广卡片位置。

短剧封面是竖版海报(2:3 左右比例),不能直接套用常见的横向 hero banner,因此本设计参考 iOS 多任务切换器(App Switcher)的视觉语言:横向排列的竖版卡片,居中卡片放大突出,左右卡片露边缩小,靠这个视觉设计本身提示"可滑动",不额外加圆点指示器。

## 数据模型

`apps/api/prisma/schema.prisma` 的 `Series` 模型新增两个字段(需要一次 migration):

```prisma
isHomeBanner  Boolean  @default(false)
bannerOrder   Int      @default(0)
```

- 只有 `isHomeBanner = true` 且 `status = 'published'` 的剧出现在首页 banner 里;剧被下架/删除时,查询里的 `status = 'published'` 过滤条件自动把它排除,不需要额外清理 `isHomeBanner` 标记
- 按 `bannerOrder` 升序排列,不设数量上限(运营自己控制别加太多)

## 后端接口

- **管理端**:复用现有的 `PATCH /api/admin/series/:id`(`apps/api/src/routes/series.ts:196-204`),`SeriesBody` 类型加上 `isHomeBanner?: boolean` 和 `bannerOrder?: number` 两个可选字段,不新建端点
- **公开端**:新增 `GET /api/series/banners`,查询条件 `{ isHomeBanner: true, status: 'published' }`,按 `bannerOrder asc` 排序,返回字段与现有 `GET /api/series` 保持一致的命名:`{ id, title, coverUrl, unlockPriceCents, freeEpisodeCount }`

## 管理后台 UI

在 `apps/web/app/admin/series/[id]/page.tsx` 已有的剧集详情表单里新增两个字段:

- checkbox「设为首页 Banner」→ 对应 `isHomeBanner`
- 数字输入框「排序值」→ 对应 `bannerOrder`,仅在勾选时显示/生效

提交沿用现有的 PATCH 提交流程,不新建管理页面。

## 首页 Banner 组件

新建 `apps/web/components/HomeBanner.tsx`,放在首页现有 `.featured-row` / `.membership-card`(VIP 推广卡片)的位置,**替换**掉它:

- 页面加载时调用 `GET /api/series/banners`;返回空数组时整个区域不渲染(不留空白占位),首页直接从 `header.home-intro` 接到 `正在流行` 网格
- 横向 `scroll-snap` 容器(`scroll-snap-type: x mandatory`),每张卡片按海报原始比例(不裁剪、不拉伸)
- 监听容器 `scroll` 事件,根据每张卡片相对容器中心的偏移量,实时计算:
  - `scale`:居中卡片 100% → 相邻卡片约 85%~90%
  - `opacity`:居中卡片 100% → 相邻卡片约 60%~70%
  - 通过 CSS `transform`/`opacity` 配合 `transition` 做平滑过渡,不用额外的动画库
- 自动播放:`setInterval` 每 4~5 秒把焦点滚动到下一张(`scrollTo` 配合 `behavior: smooth`),到最后一张后回到第一张;用户触摸/拖拽容器时清除计时器,滑动结束(`scrollend` 或防抖后)延迟几秒再重新开始自动播放,避免和手势冲突
- 点击卡片跳转 `/series/[id]`,与现有网格卡片行为一致
- 只有 1 张 banner 时:不启动自动播放循环,不做露边效果,退化为单卡居中展示

## 边界情况

- 图片加载失败:回退到现有网格卡片 `.thumb` 同款的纯色占位背景处理方式
- `GET /api/series/banners` 返回为空:首页不渲染该区域,不影响其余内容正常展示
- 现有的 VIP 会员推广卡片(`.membership-card`)在本次改动中被移除,不保留在其他位置(用户已确认此取舍;会员开通入口仍可通过 `BottomNav`/其他现有入口访问,不在本设计范围内新增)

## 测试

- 后端(`apps/api/test/series.test.ts` 新增用例):
  - `GET /api/series/banners` 只返回 `isHomeBanner: true` 且 `status: 'published'` 的剧,按 `bannerOrder` 升序
  - `PATCH /api/admin/series/:id` 能正确写入 `isHomeBanner`/`bannerOrder`
- 前端(沿用 `apps/web/test/*.mjs` 的轻量测试风格):
  - 无 banner 数据时,首页不渲染 Banner 区域
  - 只有一张 banner 时,不显示自动播放/露边效果(单卡展示)

## 验证方式

本地起 `apps/api` + `apps/web`,在管理后台把 1~3 部已发布的剧勾选为「设为首页 Banner」并设置不同排序值,检查:

- 首页顶部(原 VIP 卡片位置)正确显示轮播,居中卡片突出、两侧露边缩小
- 自动播放按设定间隔切换,手动滑动时能正确暂停自动播放并在滑动结束后恢复
- 把某个已设为 banner 的剧下架后,首页 banner 自动不再显示该剧
