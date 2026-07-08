# 短剧馆 Short Drama Membership Platform

面向台湾用户的付费短剧（短视频剧集）会员平台 MVP：LINE 登录（当前为开发期模拟）、免费集数 + 单剧解锁 + 月度会员三种付费墙组合、Cloudflare R2 视频存储 + 签名播放地址、管理后台直传视频、本地 ffmpeg 转码上传工具。

完整实现计划见 [`docs/superpowers/plans/2026-07-05-short-drama-mvp.md`](docs/superpowers/plans/2026-07-05-short-drama-mvp.md)（19 个任务的详细 TDD 步骤、代码、验收标准）。

---

## 架构蓝图

```
┌─────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  用户浏览器   │◄──────►│  apps/web         │◄──────►│  apps/api        │
│ (台湾/LINE)  │  HTTP  │  Next.js 14        │  HTTP  │  Fastify+Prisma  │
└─────────────┘        │  (公开站 + 后台)    │        │  (JWT 双角色鉴权) │
                        └──────────────────┘        └────────┬─────────┘
                                                              │
                                              ┌───────────────┼───────────────┐
                                              ▼                              ▼
                                     ┌──────────────┐              ┌──────────────────┐
                                     │  PostgreSQL   │              │  Cloudflare R2    │
                                     │ (剧集/用户/会员)│              │ (视频文件, 签名URL)│
                                     └──────────────┘              └──────────────────┘
                                                              ▲
                                                              │ 后台直传经 API；CLI 可直传 R2
                                                     ┌──────────────────┐
                                                     │  tools/uploader   │
                                                     │  本地脚本/批量上传 │
                                                     │  ffmpeg + R2 + 注册 │
                                                     └──────────────────┘
```

**关键设计决策：**
- **播放地址不经过 API 服务器转发**：API 只签发 5 分钟有效期的 R2 预签名 URL（`GET /api/episodes/:id/playback`），视频字节由浏览器直接从 R2 拉取，服务器不承担带宽压力。
- **两条上传路径**：管理后台的 `/admin/series/:id` 支持直接上传视频，API 服务端用 ffmpeg 转码后上传 R2 并注册集数；`tools/uploader` 仍可在开发者机器上跑，用于脚本化/批量上传，转码后直传 R2 再调用管理 API 注册元数据。
- **两套完全独立的鉴权体系**：管理员用账号密码 + bcrypt + JWT（`role: admin`）；用户用 LINE 登录（`role: user`）。JWT payload 统一为 `{sub, role}`，用不同的 `preHandler`（`requireAdmin` / `optionalUser`）区分。
- **付费墙优先级**（`apps/api/src/lib/access-control.ts`）：
  1. 集数 ≤ 该剧的 `freeEpisodeCount` → 无需登录直接可看
  2. 否则需要登录，且满足下列任一条件即可解锁：
     - 有未过期的月度会员（`Membership.endAt > now`，不区分具体剧集，全站通用）
     - 该用户对这一部剧单独付费解锁过（`SeriesUnlock`）
- **支付与 LINE 登录均为 MVP 阶段的显式模拟**（见下方"已知的范围内简化"），不是待修复的 bug。

---

## 目录结构

```
apps/
  api/                Fastify + Prisma + PostgreSQL 后端
    prisma/schema.prisma   数据模型（见下）
    src/routes/            REST 路由
    src/lib/                access-control.ts（付费墙核心逻辑）、r2.ts（签名URL）
    src/middleware/         requireAdmin / optionalUser
    test/                   Vitest，真实 Postgres 测试库，32 个测试
  web/                Next.js 14 App Router 前端
    app/                    公开首页、剧集详情页、管理员登录/后台/集数管理
    lib/api-client.ts       后端 API 的类型化封装
    lib/liff-mock.ts        LINE 登录的开发期模拟（localStorage 持久化假 UID）
tools/
  uploader/           本地 CLI：ffmpeg 转码 → 上传 R2 → 调管理 API 注册集数（脚本化/批量用）
docs/superpowers/plans/2026-07-05-short-drama-mvp.md   完整实现计划
```

---

## 数据模型速览（`apps/api/prisma/schema.prisma`）

| 模型 | 说明 |
|---|---|
| `Admin` | 管理员账号（用户名+bcrypt密码），与用户体系完全隔离 |
| `User` | 终端用户，`lineUid` 唯一（当前为模拟登录）；预留 `email` 字段供未来加邮箱登录 |
| `Series` | 一部短剧；`freeEpisodeCount`（默认2）、`unlockPriceCents`（默认NT$99）均可按剧单独配置；`status: draft/published` |
| `Episode` | 一集；`r2Key` 从不暴露给未登录/公开接口；`status: draft/published` |
| `SeriesUnlock` | 用户对某一部剧的解锁记录（唯一键 `userId_seriesId`），当前由管理员手动授予（模拟支付成功） |
| `MembershipPlan` | 会员套餐（当前只有一个"月度会员"，种子数据自动创建） |
| `Membership` | 用户的会员有效期记录，`endAt` 判断是否仍然生效；全站通用，不区分剧集 |

---

## 本地开发

### 前置依赖
- Node.js 20+、pnpm 9、Docker Desktop（跑 PostgreSQL）
- 如需测试后台直传或运行 `tools/uploader`，本机需要 `ffmpeg` / `ffprobe`

### 1. 启动数据库
```bash
docker compose up -d
```

### 2. 安装依赖
```bash
pnpm install
```

### 3. 配置环境变量
```bash
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.example apps/api/.env.test   # 把 DATABASE_URL 换成 shortdrama_test 库
cp apps/web/.env.local.example apps/web/.env.local
cp tools/uploader/.env.example tools/uploader/.env   # 仅在需要用 CLI 上传真实视频时配置
```
本地开发无需真实 Cloudflare R2 凭证也能跑通大部分流程——`R2_ENDPOINT` 随便填一个语法合法的 URL 即可让签名逻辑正常工作，只是点开视频不会有真实画面（没有真正的文件）。要接真实素材才需要填真实 R2 的 `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`。

### 4. 初始化数据库
```bash
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
```
种子数据会创建一个管理员账号（`SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`，默认 `admin` / `change-me-now`）和一个月度会员套餐。

### 5. 启动服务
```bash
pnpm dev:api   # http://localhost:3001
pnpm dev:web   # http://localhost:3000（如端口占用可 next dev -p <其他端口>）
```

### 6. 跑测试
```bash
pnpm test:api
```

---

## API 一览（`apps/api`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | 健康检查 |
| POST | `/api/admin/login` | 无 | 管理员登录，返回 12h 有效期 JWT |
| POST | `/api/auth/line` | 无 | 模拟 LINE 登录（信任前端传的 `lineUid`），返回 30 天有效期 JWT |
| GET/POST/PATCH | `/api/admin/series[/:id]` | Admin | 剧集增删改查（含草稿/上架） |
| GET | `/api/series` `/api/series/:id` | 无 | 公开剧集列表/详情（仅 `published`） |
| POST/PATCH | `/api/admin/episodes[/:id]` | Admin | 集数增改（含上下架） |
| GET | `/api/admin/series/:id/episodes` | Admin | 某剧全部集数（含草稿） |
| GET | `/api/series/:id/episodes` | 无 | 公开集数列表（仅 `published`，不返回 `r2Key`） |
| GET | `/api/episodes/:id/playback` | 可选登录 | 付费墙判定 + 返回 5 分钟有效期的 R2 签名播放地址；被锁时返回 `403 {error:"locked"}` |
| POST | `/api/admin/episodes/upload` | Admin | 后台直传视频，服务端排队执行 ffmpeg 转码并上传到 R2，成功后生成 `draft` 集数 |
| POST | `/api/admin/grants/membership` | Admin | 手动开通会员（替代真实支付；续期时会在剩余有效期基础上叠加，而非重置） |
| POST | `/api/admin/grants/series-unlock` | Admin | 手动解锁某剧（替代真实支付，幂等） |

---

## 前端页面（`apps/web`）

| 路径 | 说明 |
|---|---|
| `/` | 首页，公开剧集列表 |
| `/series/:id` | 剧集详情：集数列表、点击播放（免费直接看/付费触发付费墙+模拟登录按钮） |
| `/admin/login` | 管理员登录 |
| `/admin` | 管理后台：新建剧集、上架、手动开通解锁 |
| `/admin/series/:id` | 集数管理：上传视频、查看某剧全部集数状态、上架 |

内容发布流程：在 `/admin/series/:id` 直接上传视频（服务端转码 + R2 上传，生成 `draft` 集数）→ 点"上架"→ 立即在公开站可见。`tools/uploader` 仍可用于开发者机器上的脚本化/批量上传，产物同样进入后台上架流程。

---

## 已知的范围内简化（不是 bug）

| 项目 | 当前做法 | 后续替换方案 |
|---|---|---|
| 支付 | 管理员手动授予会员/解锁 | 接入绿界 ECPay / 蓝新 NewebPay，替换 `grants.ts` 里的授予逻辑，不影响 `access-control.ts` |
| LINE 登录 | 信任前端传入的 `lineUid`，未做真实 ID Token 校验 | 拿到正式 LIFF 域名后，在 `user-auth.ts` 里接入 LINE 官方的 ID Token 验证 |
| 视频编码 | 单一 MP4（H.264） | 如需自适应码率，改后台上传队列和 `tools/uploader` 的 ffmpeg 产物为 HLS；`r2Key` 约定和播放接口都不用动 |
| 账号共享 | 无并发会话/设备数限制 | 待有真实使用数据后再评估是否需要限制 |

---

## 部署注意事项

- **CORS**：`apps/api` 默认允许所有来源（`CORS_ORIGIN` 未设置时为 `*`），生产环境务必在 `apps/api/.env` 里把 `CORS_ORIGIN` 设成正式前端域名。
- **JWT_SECRET**：生产环境必须换成随机强密钥，不要用 `.env.example` 里的开发默认值。
- **服务器规格**：API + Postgres 用 4 核 4G 的小型云主机即可；后台直传会在 API 主机上跑 ffmpeg/ffprobe 并短暂占用临时磁盘。播放流量仍直接打 R2，不经过这台机器；大批量上传也可继续用 `tools/uploader` 在开发者机器上完成转码。
- **R2 凭证**：`.env` 从不提交到 git（已在 `.gitignore`），部署时需要在服务器上手动配置真实的 R2 Access Key。
