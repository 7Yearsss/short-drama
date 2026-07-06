# Auto-Seed Admin Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the API server starts and the `Admin` table is empty, automatically create one admin account from `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` env vars, so a fresh environment never needs a manual `prisma db seed` run before the admin panel is usable.

**Architecture:** A single shared function `ensureAdminExists(prisma)` in `apps/api/src/lib/seed-admin.ts` does the "count admins, create one if zero" check. It is called from two places: `server.ts` (on every boot, before `app.listen`) and `prisma/seed.ts` (kept for explicit/CI seeding). No new HTTP routes, no frontend changes.

**Tech Stack:** Fastify, Prisma (Postgres), bcryptjs (via existing `apps/api/src/lib/password.ts`), Vitest.

## Global Constraints

- Tests hit a real Postgres test database (`DATABASE_URL` in `apps/api/.env.test`), never mock Prisma — per project convention in `CLAUDE.md`.
- Default env values when unset: `SEED_ADMIN_USERNAME` → `admin`, `SEED_ADMIN_PASSWORD` → `change-me-now` (matches current `prisma/seed.ts` defaults — do not change these defaults).
- Follow existing import style: relative imports end in `.js` (ESM + TS, matches every other file under `apps/api/src`).
- One commit per task.

---

### Task 1: `ensureAdminExists` — creates the first admin, skips if one exists

**Files:**
- Create: `apps/api/src/lib/seed-admin.ts`
- Test: `apps/api/test/seed-admin.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (from `@prisma/client`), `hashPassword` (from `apps/api/src/lib/password.ts`, signature `(plain: string) => Promise<string>`).
- Produces: `ensureAdminExists(prisma: PrismaClient): Promise<void>` — used by Task 2 (`server.ts`) and Task 3 (`prisma/seed.ts`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/seed-admin.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ensureAdminExists } from '../src/lib/seed-admin.js';
import { verifyPassword } from '../src/lib/password.js';
import { cleanDb } from './helpers/clean-db.js';

const prisma = new PrismaClient();

describe('ensureAdminExists', () => {
  const originalUsername = process.env.SEED_ADMIN_USERNAME;
  const originalPassword = process.env.SEED_ADMIN_PASSWORD;

  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterEach(() => {
    process.env.SEED_ADMIN_USERNAME = originalUsername;
    process.env.SEED_ADMIN_PASSWORD = originalPassword;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an admin from env vars when none exist', async () => {
    process.env.SEED_ADMIN_USERNAME = 'testadmin';
    process.env.SEED_ADMIN_PASSWORD = 'testpass123';

    await ensureAdminExists(prisma);

    const admins = await prisma.admin.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0].username).toBe('testadmin');
    expect(await verifyPassword('testpass123', admins[0].passwordHash)).toBe(true);
  });

  it('does not create a second admin when one already exists', async () => {
    await prisma.admin.create({
      data: { username: 'existing', passwordHash: 'irrelevant-hash' },
    });

    await ensureAdminExists(prisma);

    const admins = await prisma.admin.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0].username).toBe('existing');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test -- seed-admin`
Expected: FAIL — `Cannot find module '../src/lib/seed-admin.js'` (or similar resolution error), since the file doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/src/lib/seed-admin.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password.js';

export async function ensureAdminExists(prisma: PrismaClient): Promise<void> {
  const count = await prisma.admin.count();
  if (count > 0) {
    console.log('admin already exists, skipping auto-seed');
    return;
  }

  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';

  await prisma.admin.create({
    data: { username, passwordHash: await hashPassword(password) },
  });
  console.log(`no admin found, auto-created default admin account: ${username}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test -- seed-admin`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/seed-admin.ts apps/api/test/seed-admin.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add ensureAdminExists to auto-create first admin account

Reads SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD and creates an admin
only when the Admin table is empty; no-op otherwise.
EOF
)"
```

---

### Task 2: Wire `ensureAdminExists` into server startup

**Files:**
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `ensureAdminExists(prisma: PrismaClient): Promise<void>` (Task 1), `app.prisma` (already typed as `PrismaClient` via `apps/api/src/types/fastify.d.ts:5`).
- Produces: nothing new consumed by later tasks — this is the integration point.

There's no existing automated test around `server.ts` boot (it's a thin `app.listen` wrapper with no test file today), so this task is verified manually against the real local dev server rather than adding a new automated test — consistent with YAGNI, since `ensureAdminExists` itself is already fully covered by Task 1.

- [ ] **Step 1: Update `server.ts` to call `ensureAdminExists` before listening**

Replace the full contents of `apps/api/src/server.ts`:

```typescript
import 'dotenv/config';
import { buildApp } from './app.js';
import { ensureAdminExists } from './lib/seed-admin.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);

async function start() {
  await ensureAdminExists(app.prisma);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`API listening on :${port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Manually verify against the local dev database**

Confirm the local Postgres container is running (it already is, from `docker-compose.yml` — `docker ps` should show `short-drama-postgres-1`).

Wipe the local `Admin` table to simulate a fresh environment, then start the server:

```bash
docker exec short-drama-postgres-1 psql -U shortdrama -d shortdrama -c 'DELETE FROM "Admin";'
pnpm --filter api dev
```

Expected in the terminal output: `API listening on :3001` with no errors. Then, in a second terminal, confirm an admin now exists:

```bash
docker exec short-drama-postgres-1 psql -U shortdrama -d shortdrama -c 'SELECT username FROM "Admin";'
```

Expected: one row, matching `SEED_ADMIN_USERNAME` from `apps/api/.env` (defaults to `admin` if unset there). Stop the dev server (Ctrl+C) once confirmed.

Run the existing full test suite once more to make sure nothing regressed:

```bash
pnpm --filter api test
```

Expected: all tests pass (existing suite + the 2 new `seed-admin` tests).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): auto-create admin account on server startup

Calls ensureAdminExists before listening so a fresh environment
never needs a manual `prisma db seed` run to get admin access.
EOF
)"
```

---

### Task 3: Reuse `ensureAdminExists` in `prisma/seed.ts`

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:**
- Consumes: `ensureAdminExists(prisma: PrismaClient): Promise<void>` (Task 1).
- Produces: nothing consumed by later tasks (this is the last task in the plan).

- [ ] **Step 1: Replace the manual admin upsert with `ensureAdminExists`**

Replace the full contents of `apps/api/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { ensureAdminExists } from '../src/lib/seed-admin.js';

const prisma = new PrismaClient();

async function main() {
  await ensureAdminExists(prisma);

  await prisma.membershipPlan.upsert({
    where: { id: 'monthly-plan' },
    create: { id: 'monthly-plan', name: '月度会员', priceCents: 29900, durationDays: 30 },
    update: {},
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

Note: this drops the `bcryptjs` import from this file (no longer hashing inline) and the `username`/`password` local variables (now read inside `ensureAdminExists`) — both are now dead code once removed, so the diff should show them gone, not left unused.

- [ ] **Step 2: Run the seed script against the local dev database to verify it still works**

```bash
cd apps/api && npx prisma db seed
```

Expected output includes no errors (the "major version upgrade available" notice from Prisma is pre-existing and unrelated — ignore it).

Verify idempotency by running it a second time immediately:

```bash
npx prisma db seed
```

Expected: still no errors, and the admin count is unchanged:

```bash
docker exec short-drama-postgres-1 psql -U shortdrama -d shortdrama -c 'SELECT count(*) FROM "Admin";'
```

Expected: `1`.

- [ ] **Step 3: Run the full API test suite one final time**

```bash
pnpm --filter api test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "$(cat <<'EOF'
refactor(api): reuse ensureAdminExists in prisma seed script

Removes the duplicate admin-upsert logic from prisma/seed.ts so the
startup auto-seed and the explicit seed command share one code path.
EOF
)"
```
