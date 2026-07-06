# 自动初始化 admin 账号

## 背景

目前 `Admin` 表的第一条数据只能通过手动跑 `pnpm --filter api exec prisma db seed` 生成,读取 `.env` 里的 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`。新环境(比如生产服务器)第一次启动时,如果忘了跑这条命令,后台就完全登录不进去,且没有任何提示。

参考 `E:\CodeCode\new-api\model\main.go` 的 `createRootAccountIfNeed`:服务启动时自动检查"是否已有用户",没有就自动建一个默认账号,不需要额外的人工步骤,也不需要注册页面/接口。

## 设计

在 API 服务启动流程中(`apps/api/src/server.ts`,`app.listen(...)` 之前)增加一次检查:

1. `const count = await prisma.admin.count()`
2. 如果 `count === 0`:用 `.env` 里的 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`(与现有 `prisma/seed.ts` 读的是同一对变量,默认值也保持一致:`admin` / `change-me-now`)创建一个 admin,密码用现有的 `hashPassword`(`apps/api/src/lib/password.ts`,与 `admin-auth.ts` 里 `verifyPassword` 配套)。
3. 如果 `count > 0`:什么都不做,直接继续启动。
4. 无论哪种情况都打一行日志(`app.log.info`),说明是"自动创建了默认 admin"还是"已存在 admin,跳过"——方便部署时确认到底走了哪条分支。

不引入新接口、不改前端、不做"仅此一次可注册"的锁定逻辑——本来就是"数据库里没有就建,有就跳过",天然幂等,不存在重复创建的风险。

`prisma/seed.ts` 保持不变(继续可用于测试/CI里显式建种子数据),两者用同一段逻辑,可以抽成 `apps/api/src/lib/seed-admin.ts` 里的一个函数,`server.ts` 和 `prisma/seed.ts` 都调用它,避免逻辑重复。

## 涉及文件

- 新增 `apps/api/src/lib/seed-admin.ts`:导出 `ensureAdminExists(prisma)` 函数,内部做上述 count 检查 + 创建。
- 修改 `apps/api/src/server.ts`:`app.listen` 之前调用 `ensureAdminExists(app.prisma)`。
- 修改 `apps/api/prisma/seed.ts`:admin 部分改为调用同一个 `ensureAdminExists`,避免重复逻辑(会员计划种子数据保持原样,不受影响)。

## 测试

`apps/api/test/seed-admin.test.ts`(真实 Postgres,按仓库约定不 mock 数据库):

- 空库调用 `ensureAdminExists` 后,`prisma.admin.count()` 变为 1,且用户名/密码哈希能通过 `verifyPassword` 校验成功。
- 已有 admin 时调用 `ensureAdminExists`,不新增记录、不修改已有记录(`count` 保持不变)。

## 范围外

- 不做注册页面/注册接口。
- 不做"首次登录强制改密码"之类的引导——`.env` 里的密码就是生产环境要用的密码,部署前自己在 `.env` 里改好即可(这部分已经写在 [CLAUDE.md](../../../CLAUDE.md) 的生产部署清单里)。
