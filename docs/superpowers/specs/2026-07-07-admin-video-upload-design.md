# 后台管理员上传视频功能 — 设计文档

日期:2026-07-07

## 背景

当前视频上传流程是本地脚本 `tools/uploader`(ffmpeg 转码 + PutObject 到 R2 + 调 `POST /api/admin/episodes` 登记),完全在开发者本机跑,不走后台网页。有一部 53 集的短剧需要陆续上传,每次都要开发者本人在本机手动跑脚本不现实。

目标:后台管理页面直接支持"选视频文件上传",服务端(未来部署在 Linux 云主机,4 核 4G)内部完成 ffmpeg 转码、上传到 R2 短剧视频私有桶(`short-drama`),并把 Episode 记录写入数据库。封面上传一并加入(公开桶 `short-drama-covers`)。

## 架构

浏览器 multipart 上传视频文件到 API → API 落盘到本地临时目录,立刻创建一条 `Episode` 记录(`status: processing`)并返回给前端 → 进程内任务队列(无 Redis/BullMQ,顺序处理,一次一个)依次执行:ffmpeg 转码 → 上传到 R2 → 成功则 `status: draft`(可上架)并删除本地临时文件;失败则 `status: failed`,本地文件保留,管理员可点"重试"直接复用本地文件重新走一遍转码+上传,无需重新上传。

封面图片走独立的同步接口,不入队(文件小,处理快)。

选用进程内顺序队列而非分布式队列,是因为:4 核 4G 单机部署、上传频率低(人工陆续上传剧集,不是高并发场景)、无需引入 Redis 等额外基础设施,符合 PeerTube/Jellyfin 等自托管系统的常见做法。

## 数据模型改动

`apps/api/prisma/schema.prisma` 的 `Episode` model:

- `r2Key` 从必填改为可空(`String?`)—— 转码上传完成前还不知道最终 key
- 新增 `uploadError String?` —— 失败原因,供前端展示
- 新增 `tempVideoPath String?` —— 本地临时原始文件路径,重试时复用,成功后清空
- `status` 取值扩展为 `processing` / `draft` / `published` / `failed`(原来只有 `draft`/`published`)

需要一条 Prisma 迁移。

## API 改动

`apps/api/src/routes/episodes.ts`:

- `POST /api/admin/episodes/upload`(multipart:`seriesId`、`episodeNumber`、`title`、视频文件)
  - 同步校验:剧存在、集数未被占用、文件类型合法 —— 不合法直接 400,不建记录
  - 校验通过后:视频流式落盘到本地临时目录、创建 Episode 记录(`status: processing`)、任务入队,立即返回该记录
- `POST /api/admin/episodes/:id/retry`
  - 仅当 `status === 'failed'` 时可用,否则 409
  - 复用已保留的 `tempVideoPath` 重新入队(不需要重新上传文件)

新增 `apps/api/src/routes/covers.ts`:

- `POST /api/admin/covers/upload`(multipart 图片)—— 同步直接上传到 `short-drama-covers` 公开桶,返回 `{ url }`

现有 `GET /api/admin/series/:id/episodes` 已经会带上 `status` 字段,前端轮询这个接口即可获知处理进度,不需要新增专门的进度查询接口。

## 服务启动行为

进程内队列不持久化。若服务重启,遗留在 `processing` 状态的 Episode 记录会呈现"卡死"假象(实际任务已随进程消失)。服务启动时(与 `ensureAdminExists` 同一处)执行:

```sql
UPDATE "Episode" SET status = 'failed', "uploadError" = '服务重启导致任务中断,请重试' WHERE status = 'processing';
```

这样管理员看到的是"失败可重试",而不是永远转圈。

## 前端改动

`apps/web/app/admin/series/[id]/page.tsx`:

- 新增上传表单(集数、标题、选择视频文件)
- 集数列表增加 `processing`(⏳ 转码中…)、`failed`(❌ 失败,带"重试"按钮)两种新状态样式
- 只要列表中存在 `processing` 的集数,就每 3 秒轮询一次 `GET /api/admin/series/:id/episodes` 刷新状态
- 移除"新增集数请用本地上传工具"的提示文案

`apps/web/app/admin/page.tsx`:

- 新建剧集抽屉里增加封面文件选择;提交时先调用封面上传接口拿到 URL,再用该 URL 创建剧集

## 范围限制(暂不做)

- 批量上传多个文件 —— 先只支持单个视频文件上传
- 转码产物/中间态缓存 —— 重试统一走"重新转码+重传",不做转码产物本地缓存
- 上传进度百分比展示 —— 只做粗粒度状态(处理中/失败/草稿/已上架),不做字节级进度条

## 新增依赖

`@fastify/multipart`(流式落盘,避免大文件全部读入内存)

## 测试策略

遵循项目约定:真实 Postgres,不 mock 数据库;ffmpeg 调用和 R2 上传调用会被 mock(测试环境不依赖真实转码和真实网络)。

- `apps/api/test/episodes-upload.test.ts`:上传接口建 Episode 记录(`status: processing`);字段校验(集数重复 / 剧不存在返回 400)
- `apps/api/test/upload-queue.test.ts`:队列处理逻辑单测,mock 转码函数和 R2 上传函数 —— 成功路径写 `r2Key` + `status: draft` + 清空 `tempVideoPath`;失败路径写 `uploadError` + `status: failed` + 保留 `tempVideoPath`
- `apps/api/test/episodes-retry.test.ts`:重试接口仅对 `failed` 状态生效,非 `failed` 返回 409;重试后重新入队
- `apps/api/test/covers-upload.test.ts`:封面上传接口返回可访问的公开 URL
- `apps/api/test/server-restart-recovery.test.ts`:遗留 `processing` 记录在服务启动时被标记为 `failed`

真实 ffmpeg 转码流程不在自动化测试范围内(与现有 `tools/uploader` 一致),本地手动跑一次验证即可。
