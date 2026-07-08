# CLAUDE.md

给 Claude Code 在本仓库工作时的上下文。项目概览/架构见 [README.md](README.md)，完整实现计划见 [`docs/superpowers/plans/2026-07-05-short-drama-mvp.md`](docs/superpowers/plans/2026-07-05-short-drama-mvp.md)。

## 后续待办（按优先级）

1. **申请 LINE LIFF 域名 + 接入真实登录**
   - 当前 `apps/api/src/routes/user-auth.ts` 信任前端传入的 `lineUid`，未做真实 ID Token 校验（`apps/web/lib/liff-mock.ts` 是纯前端模拟）。
   - 有正式域名后：在 LINE Developers Console 创建 LIFF app，把 `liff-mock.ts` 换成真实的 `@line/liff` SDK 调用，并在 `user-auth.ts` 里验证 LINE 返回的 ID Token（而不是直接信任 `lineUid`）。

2. **接入真实支付（绿界 ECPay 或蓝新 NewebPay）**
   - 当前用 `apps/api/src/routes/grants.ts` 的管理员手动授予接口代替真实支付（会员开通 + 单剧解锁）。
   - 替换时只需要在支付回调成功后调用同样的授予逻辑，`access-control.ts` 的付费墙判定完全不用改。
   - 需要决定：单剧解锁价格（当前每部剧可单独配置 `unlockPriceCents`，默认 NT$99）和会员定价（当前月度 NT$299，`MembershipPlan` 种子数据）是否要调整。

3. **生产环境部署清单**
   - 云主机（4核4G）上部署 `apps/api` + PostgreSQL。
   - `apps/api/.env`：换真实 `JWT_SECRET`（随机强密钥）、真实 R2 凭证（`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT`）、`CORS_ORIGIN` 设成正式前端域名（不能留 `*`）、`SEED_ADMIN_PASSWORD` 换成真实强密码（默认是 `change-me-now`，API 服务启动时如果 `Admin` 表是空的会自动拿这个密码建一个能直接登录的 admin 账号，生产环境不改会留下已知密码的管理员账号）。
   - `apps/web` 部署（Vercel 或同一台云主机），`NEXT_PUBLIC_API_BASE_URL` 指向正式 API 域名。
   - 隐私政策/服务条款页面（LINE Developers Console 创建 Provider 时需要这两个 URL）。

4. **视频上传/转码流程验证**
   - 管理后台 `/admin/series/:id` 已支持直接上传视频，由 API 服务端执行 ffmpeg 转码并上传到 R2；`tools/uploader` 仍保留给开发者机器上的脚本化/批量上传使用。第一次接真实短剧素材时，两条路径都建议各跑一次端到端验证。

## 暂不做（除非用户明确要求）

- HLS 多码率转码（当前单一 MP4 足够 MVP 验证）
- 会员账号共享/并发会话限制（等有真实用户数据再评估要不要做）
- 邮箱登录（`User.email` 字段已预留，但 LINE 登录跑通之前不用管）

## 本地开发已知的坑

- 端口 3000 可能被本机其他项目占用（这台机器上是 `new-api-dev` 容器），`apps/web` 需要用 `next dev -p <其他端口>` 启动。
- `next build` / `next dev` 会自动往 `apps/web/tsconfig.json` 里加 `.next/types` 的 include 和 `next` 插件项——这是 Next.js 的正常行为，提交代码前记得 `git checkout -- apps/web/tsconfig.json` 撤掉这个自动改动，避免污染 diff。
- 本地不需要真实 R2 凭证也能跑通签名 URL 逻辑，`R2_ENDPOINT` 填一个语法合法的假地址即可；只是点击播放不会有真实画面。

## 协作约定

- 小步提交，每个 commit 只做一件事（参考现有 git log 的粒度）。
- 后端改动先写测试再实现（`apps/api/test/`，Vitest + 真实 Postgres 测试库，不 mock 数据库）。
- 不要引入本计划范围外的抽象/功能——参照 README 里"已知的范围内简化"表，那些是有意为之的决定，不是要顺手修的 bug。
