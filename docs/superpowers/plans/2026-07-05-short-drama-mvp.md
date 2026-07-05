# Short Drama Membership Platform — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP of a short-drama membership website: browse series for free (first N episodes per series), unlock full series or subscribe monthly (both granted manually by an admin for now — no real payment yet), log in via a mocked LINE identity, and manage content through an admin panel fed by a local transcode-and-upload CLI tool.

**Architecture:** A pnpm monorepo with three packages: `apps/api` (Fastify + TypeScript + Prisma/PostgreSQL, the only service talking to the database and to Cloudflare R2), `apps/web` (Next.js App Router frontend serving the public site and the admin panel), and `tools/uploader` (a Node CLI that runs on the developer's local machine: transcodes a raw video with `ffmpeg`, uploads the result straight to R2, then registers the episode via the admin API). The API is the single source of truth for access control: every playback request is checked against free-episode thresholds, active memberships, and per-series unlocks before a short-lived R2 signed URL is issued. Nothing touches the API's host machine except the Fastify process and PostgreSQL — transcoding never runs there.

**Tech Stack:** Node.js + TypeScript, Fastify, `@fastify/jwt`, Prisma + PostgreSQL, `bcryptjs`, `@aws-sdk/client-s3` + `s3-request-presigner` (R2 is S3-compatible), Vitest for backend tests, Next.js 14 (App Router) + React for the frontend, plain `ffmpeg`/`ffprobe` binaries invoked from the uploader CLI.

---

## Before you start

- Node.js 20+, `pnpm` 9+, Docker (for local PostgreSQL), and `ffmpeg`/`ffprobe` on PATH (only needed for Task 13, the uploader).
- All commands below assume the working directory is the repo root `E:\CodeCode\short-drama` unless stated otherwise.
- The repo has been `git init`-ed already; there is no remote yet — commits are local only.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "short-drama",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "test:api": "pnpm --filter api test"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - tools/*
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.next/
.env
.env.test
*.log
```

- [ ] **Step 4: Create `docker-compose.yml` for local PostgreSQL**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: shortdrama
      POSTGRES_PASSWORD: shortdrama
      POSTGRES_DB: shortdrama
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 5: Create `README.md`**

```markdown
# Short Drama Membership Platform

Monorepo: `apps/api` (Fastify backend), `apps/web` (Next.js frontend), `tools/uploader` (local transcode+upload CLI).

## Local dev
1. `docker compose up -d` — starts PostgreSQL
2. `pnpm install`
3. `pnpm --filter api exec prisma migrate dev`
4. `pnpm --filter api exec prisma db seed`
5. `pnpm dev:api` and `pnpm dev:web` in separate terminals
```

- [ ] **Step 6: Start PostgreSQL and verify it's reachable**

Run: `docker compose up -d && docker compose ps`
Expected: `postgres` service listed as `running`/`healthy`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore docker-compose.yml README.md
git commit -m "chore: scaffold monorepo workspace"
```

---

### Task 2: API project scaffold + Prisma schema + seed

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/.env.example`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/test/setup.ts`
- Create: `apps/api/test/helpers/clean-db.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0",
    "@fastify/jwt": "^8.0.0",
    "@prisma/client": "^5.18.0",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.14.0",
    "prisma": "^5.18.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/api/.env.example`**

```
DATABASE_URL=postgresql://shortdrama:shortdrama@localhost:5432/shortdrama
JWT_SECRET=dev-secret-change-me
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=short-drama
PORT=3001
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=change-me-now
```

Copy it to a real `.env` (not committed): `cp apps/api/.env.example apps/api/.env` and adjust values for your machine.

Also create `apps/api/.env.test` with a separate test database:

```
DATABASE_URL=postgresql://shortdrama:shortdrama@localhost:5432/shortdrama_test
JWT_SECRET=test-secret
R2_ENDPOINT=https://example.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=test
R2_SECRET_ACCESS_KEY=test
R2_BUCKET=short-drama-test
```

Create the test database once: `docker compose exec postgres psql -U shortdrama -c "CREATE DATABASE shortdrama_test;"`

- [ ] **Step 4: Create `apps/api/prisma/schema.prisma`**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Admin {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}

model User {
  id        String   @id @default(uuid())
  lineUid   String?  @unique
  email     String?  @unique
  nickname  String
  avatarUrl String?
  createdAt DateTime @default(now())

  seriesUnlocks SeriesUnlock[]
  memberships   Membership[]
}

model Series {
  id               String   @id @default(uuid())
  title            String
  description      String?
  coverUrl         String?
  freeEpisodeCount Int      @default(2)
  unlockPriceCents Int      @default(9900)
  status           String   @default("draft")
  createdAt        DateTime @default(now())

  episodes      Episode[]
  seriesUnlocks SeriesUnlock[]
}

model Episode {
  id              String   @id @default(uuid())
  seriesId        String
  episodeNumber   Int
  title           String
  r2Key           String
  durationSeconds Int?
  status          String   @default("draft")
  createdAt       DateTime @default(now())

  series Series @relation(fields: [seriesId], references: [id])

  @@unique([seriesId, episodeNumber])
}

model SeriesUnlock {
  id         String   @id @default(uuid())
  userId     String
  seriesId   String
  source     String   @default("manual")
  unlockedAt DateTime @default(now())

  user   User   @relation(fields: [userId], references: [id])
  series Series @relation(fields: [seriesId], references: [id])

  @@unique([userId, seriesId])
}

model MembershipPlan {
  id           String @id @default(uuid())
  name         String
  priceCents   Int
  durationDays Int

  memberships Membership[]
}

model Membership {
  id      String   @id @default(uuid())
  userId  String
  planId  String
  startAt DateTime @default(now())
  endAt   DateTime
  source  String   @default("manual")

  user User           @relation(fields: [userId], references: [id])
  plan MembershipPlan @relation(fields: [planId], references: [id])
}
```

- [ ] **Step 5: Create `apps/api/prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';
  await prisma.admin.upsert({
    where: { username },
    create: { username, passwordHash: await bcrypt.hash(password, 10) },
    update: {},
  });

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

- [ ] **Step 6: Install deps, run migration, run seed**

Run:
```bash
pnpm install
pnpm --filter api exec prisma migrate dev --name init
pnpm --filter api exec prisma db seed
```
Expected: migration creates all 6 tables in `shortdrama` DB; seed logs no errors and creates one admin + one membership plan.

- [ ] **Step 7: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
  },
});
```

- [ ] **Step 8: Create `apps/api/test/setup.ts`**

```ts
import { config } from 'dotenv';

config({ path: '.env.test' });
```

- [ ] **Step 9: Create `apps/api/test/helpers/clean-db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export async function cleanDb(prisma: PrismaClient) {
  await prisma.seriesUnlock.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.series.deleteMany();
  await prisma.membershipPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
}
```

- [ ] **Step 10: Apply the same migration to the test database**

Run: `DATABASE_URL="postgresql://shortdrama:shortdrama@localhost:5432/shortdrama_test" pnpm --filter api exec prisma migrate deploy`
Expected: all 6 tables created in `shortdrama_test`.

- [ ] **Step 11: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/.env.example apps/api/prisma apps/api/vitest.config.ts apps/api/test
git commit -m "feat(api): scaffold project, prisma schema, seed, test setup"
```

---

### Task 3: Fastify app bootstrap + health check

**Files:**
- Create: `apps/api/src/types/fastify.d.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/test/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/health.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- health.test.ts`
Expected: FAIL — `../src/app.js` does not exist yet.

- [ ] **Step 3: Create the Fastify type augmentation**

```ts
// apps/api/src/types/fastify.d.ts
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    currentAdmin?: { id: string };
    currentUser?: { id: string };
  }
}
```

- [ ] **Step 4: Create the health route**

```ts
// apps/api/src/routes/health.ts
import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }));
}
```

- [ ] **Step 5: Create `apps/api/src/app.ts`**

```ts
import Fastify, { FastifyInstance } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  prisma?: PrismaClient;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const prisma = opts.prisma ?? new PrismaClient();

  app.decorate('prisma', prisma);
  app.register(jwtPlugin, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });

  app.register(healthRoutes);

  app.addHook('onClose', async () => {
    if (!opts.prisma) {
      await prisma.$disconnect();
    }
  });

  return app;
}
```

- [ ] **Step 6: Create `apps/api/src/server.ts`**

```ts
import 'dotenv/config';
import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`API listening on :${port}`);
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter api test -- health.test.ts`
Expected: PASS (1 test)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/types/fastify.d.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/health.ts apps/api/test/health.test.ts
git commit -m "feat(api): bootstrap fastify app with health check"
```

---

### Task 4: Password hashing utility

**Files:**
- Create: `apps/api/src/lib/password.ts`
- Test: `apps/api/test/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password hashing', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('correct-horse');
    expect(hash).not.toBe('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- password.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/lib/password.ts
import bcrypt from 'bcryptjs';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- password.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/password.ts apps/api/test/password.test.ts
git commit -m "feat(api): add password hashing utility"
```

---

### Task 5: Admin login + requireAdmin middleware

**Files:**
- Create: `apps/api/src/routes/admin-auth.ts`
- Create: `apps/api/src/middleware/require-admin.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/admin-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/admin-auth.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

describe('POST /api/admin/login', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns a token for valid credentials', async () => {
    await prisma.admin.create({
      data: { username: 'boss', passwordHash: await hashPassword('secret123') },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'boss', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf('string');
    await app.close();
  });

  it('rejects an invalid password', async () => {
    await prisma.admin.create({
      data: { username: 'boss', passwordHash: await hashPassword('secret123') },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'boss', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an unknown username', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'nobody', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- admin-auth.test.ts`
Expected: FAIL — route `/api/admin/login` returns 404.

- [ ] **Step 3: Create `require-admin.ts` middleware**

```ts
// apps/api/src/middleware/require-admin.ts
import { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<{ sub: string; role: string }>();
    if (payload.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    request.currentAdmin = { id: payload.sub };
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}
```

- [ ] **Step 4: Create the admin auth route**

```ts
// apps/api/src/routes/admin-auth.ts
import { FastifyInstance } from 'fastify';
import { verifyPassword } from '../lib/password.js';

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/admin/login',
    async (request, reply) => {
      const { username, password } = request.body;
      const admin = await app.prisma.admin.findUnique({ where: { username } });
      if (!admin) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const valid = await verifyPassword(password, admin.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const token = app.jwt.sign({ sub: admin.id, role: 'admin' }, { expiresIn: '12h' });
      return { token };
    }
  );
}
```

- [ ] **Step 5: Register the route in `app.ts`**

In `apps/api/src/app.ts`, add the import and registration:

```ts
import { adminAuthRoutes } from './routes/admin-auth.js';
```

```ts
  app.register(healthRoutes);
  app.register(adminAuthRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter api test -- admin-auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-auth.ts apps/api/src/middleware/require-admin.ts apps/api/src/app.ts apps/api/test/admin-auth.test.ts
git commit -m "feat(api): admin login and requireAdmin middleware"
```

---

### Task 6: User LINE (mock) login + optionalUser middleware

**Files:**
- Create: `apps/api/src/routes/user-auth.ts`
- Create: `apps/api/src/middleware/optional-user.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/user-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/user-auth.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';

const prisma = new PrismaClient();

describe('POST /api/auth/line', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a new user on first login', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      payload: { lineUid: 'U123', nickname: 'Ken' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.user.lineUid).toBe('U123');
    const count = await prisma.user.count();
    expect(count).toBe(1);
    await app.close();
  });

  it('reuses the same user on subsequent logins with the same lineUid', async () => {
    const app = buildApp({ prisma });
    await app.inject({ method: 'POST', url: '/api/auth/line', payload: { lineUid: 'U123', nickname: 'Ken' } });
    await app.inject({ method: 'POST', url: '/api/auth/line', payload: { lineUid: 'U123', nickname: 'Ken Xu' } });
    const count = await prisma.user.count();
    expect(count).toBe(1);
    await app.close();
  });

  it('rejects a request missing lineUid', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'POST', url: '/api/auth/line', payload: { nickname: 'Ken' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- user-auth.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Create the user auth route**

Note: this endpoint currently trusts the `lineUid` sent by the client — it does not yet verify a real LINE ID token against LINE's servers. That's acceptable for local development (no LIFF domain is registered yet). Before going to production with a real LIFF app, this must be replaced with server-side verification of the LIFF ID token.

```ts
// apps/api/src/routes/user-auth.ts
import { FastifyInstance } from 'fastify';

export async function userAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { lineUid: string; nickname: string; avatarUrl?: string } }>(
    '/api/auth/line',
    async (request, reply) => {
      const { lineUid, nickname, avatarUrl } = request.body ?? {};
      if (!lineUid || !nickname) {
        return reply.code(400).send({ error: 'lineUid and nickname required' });
      }
      const user = await app.prisma.user.upsert({
        where: { lineUid },
        create: { lineUid, nickname, avatarUrl },
        update: { nickname, avatarUrl },
      });
      const token = app.jwt.sign({ sub: user.id, role: 'user' }, { expiresIn: '30d' });
      return { token, user };
    }
  );
}
```

- [ ] **Step 4: Create the `optionalUser` middleware**

```ts
// apps/api/src/middleware/optional-user.ts
import { FastifyReply, FastifyRequest } from 'fastify';

export async function optionalUser(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.headers.authorization) return;
  try {
    const payload = await request.jwtVerify<{ sub: string; role: string }>();
    if (payload.role === 'user') {
      request.currentUser = { id: payload.sub };
    }
  } catch {
    // invalid/expired token: treat the request as anonymous
  }
}
```

- [ ] **Step 5: Register the route in `app.ts`**

```ts
import { userAuthRoutes } from './routes/user-auth.js';
```

```ts
  app.register(adminAuthRoutes);
  app.register(userAuthRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter api test -- user-auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/user-auth.ts apps/api/src/middleware/optional-user.ts apps/api/src/app.ts apps/api/test/user-auth.test.ts
git commit -m "feat(api): mock LINE login and optionalUser middleware"
```

---

### Task 7: Series admin CRUD + public series endpoints

**Files:**
- Create: `apps/api/src/routes/series.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/series.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/series.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'secret123' } });
  return res.json().token as string;
}

describe('series routes', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects series creation without an admin token', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'POST', url: '/api/admin/series', payload: { title: '甜宠日记' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates a series with default freeEpisodeCount and unlockPriceCents', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/series',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '甜宠日记' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.freeEpisodeCount).toBe(2);
    expect(body.unlockPriceCents).toBe(9900);
    expect(body.status).toBe('draft');
    await app.close();
  });

  it('does not list draft series on the public endpoint', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/series',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '甜宠日记' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/series' });
    expect(res.json()).toHaveLength(0);
    await app.close();
  });

  it('lists a series on the public endpoint once published', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/series',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '甜宠日记' },
    });
    const seriesId = created.json().id as string;
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/series/${seriesId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'published' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/series' });
    expect(res.json()).toHaveLength(1);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- series.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Create the series routes**

```ts
// apps/api/src/routes/series.ts
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

interface SeriesBody {
  title: string;
  description?: string;
  coverUrl?: string;
  freeEpisodeCount?: number;
  unlockPriceCents?: number;
  status?: string;
}

export async function seriesRoutes(app: FastifyInstance) {
  app.post<{ Body: SeriesBody }>('/api/admin/series', { preHandler: requireAdmin }, async (request) => {
    const { title, description, coverUrl, freeEpisodeCount, unlockPriceCents } = request.body;
    return app.prisma.series.create({
      data: {
        title,
        description,
        coverUrl,
        freeEpisodeCount: freeEpisodeCount ?? 2,
        unlockPriceCents: unlockPriceCents ?? 9900,
      },
    });
  });

  app.get('/api/admin/series', { preHandler: requireAdmin }, async () => {
    return app.prisma.series.findMany({ orderBy: { createdAt: 'desc' } });
  });

  app.patch<{ Params: { id: string }; Body: SeriesBody }>(
    '/api/admin/series/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await app.prisma.series.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      return app.prisma.series.update({ where: { id: request.params.id }, data: request.body });
    }
  );

  app.get('/api/series', async () => {
    return app.prisma.series.findMany({ where: { status: 'published' }, orderBy: { createdAt: 'desc' } });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id', async (request, reply) => {
    const series = await app.prisma.series.findFirst({ where: { id: request.params.id, status: 'published' } });
    if (!series) return reply.code(404).send({ error: 'not_found' });
    return series;
  });
}
```

- [ ] **Step 4: Register the route in `app.ts`**

```ts
import { seriesRoutes } from './routes/series.js';
```

```ts
  app.register(userAuthRoutes);
  app.register(seriesRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- series.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/series.ts apps/api/src/app.ts apps/api/test/series.test.ts
git commit -m "feat(api): series admin CRUD and public endpoints"
```

---

### Task 8: Episode admin CRUD + listing endpoints

**Files:**
- Create: `apps/api/src/routes/episodes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/episodes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/episodes.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'secret123' } });
  return res.json().token as string;
}

async function createSeries(app: ReturnType<typeof buildApp>, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/series',
    headers: { authorization: `Bearer ${token}` },
    payload: { title: '甜宠日记' },
  });
  return res.json().id as string;
}

describe('episode routes', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an episode under a series', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { seriesId, episodeNumber: 1, title: '第1集', r2Key: 'series/1/ep1.mp4', durationSeconds: 300 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('draft');
    await app.close();
  });

  it('rejects an episode for a non-existent series', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { seriesId: 'does-not-exist', episodeNumber: 1, title: '第1集', r2Key: 'x.mp4' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('public episode listing excludes draft episodes and the r2Key field', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { seriesId, episodeNumber: 1, title: '第1集', r2Key: 'series/1/ep1.mp4' },
    });
    const episodeId = created.json().id as string;

    let res = await app.inject({ method: 'GET', url: `/api/series/${seriesId}/episodes` });
    expect(res.json()).toHaveLength(0);

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/episodes/${episodeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'published' },
    });

    res = await app.inject({ method: 'GET', url: `/api/series/${seriesId}/episodes` });
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].r2Key).toBeUndefined();
    await app.close();
  });

  it('admin episode listing includes drafts', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    await app.inject({
      method: 'POST',
      url: '/api/admin/episodes',
      headers: { authorization: `Bearer ${token}` },
      payload: { seriesId, episodeNumber: 1, title: '第1集', r2Key: 'series/1/ep1.mp4' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/series/${seriesId}/episodes`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toHaveLength(1);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- episodes.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Create the episode routes**

```ts
// apps/api/src/routes/episodes.ts
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

interface CreateEpisodeBody {
  seriesId: string;
  episodeNumber: number;
  title: string;
  r2Key: string;
  durationSeconds?: number;
}

interface UpdateEpisodeBody {
  title?: string;
  status?: string;
  durationSeconds?: number;
}

export async function episodeRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateEpisodeBody }>(
    '/api/admin/episodes',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { seriesId, episodeNumber, title, r2Key, durationSeconds } = request.body;
      const series = await app.prisma.series.findUnique({ where: { id: seriesId } });
      if (!series) return reply.code(404).send({ error: 'series_not_found' });
      return app.prisma.episode.create({
        data: { seriesId, episodeNumber, title, r2Key, durationSeconds },
      });
    }
  );

  app.patch<{ Params: { id: string }; Body: UpdateEpisodeBody }>(
    '/api/admin/episodes/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      return app.prisma.episode.update({ where: { id: request.params.id }, data: request.body });
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/series/:id/episodes', { preHandler: requireAdmin }, async (request) => {
    return app.prisma.episode.findMany({ where: { seriesId: request.params.id }, orderBy: { episodeNumber: 'asc' } });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id/episodes', async (request) => {
    return app.prisma.episode.findMany({
      where: { seriesId: request.params.id, status: 'published' },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, episodeNumber: true, title: true, durationSeconds: true },
    });
  });
}
```

- [ ] **Step 4: Register the route in `app.ts`**

```ts
import { episodeRoutes } from './routes/episodes.js';
```

```ts
  app.register(seriesRoutes);
  app.register(episodeRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- episodes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/episodes.ts apps/api/src/app.ts apps/api/test/episodes.test.ts
git commit -m "feat(api): episode admin CRUD and listing endpoints"
```

---

### Task 9: Access control helper

**Files:**
- Create: `apps/api/src/lib/access-control.ts`
- Test: `apps/api/test/access-control.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/access-control.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { cleanDb } from './helpers/clean-db.js';
import { hasAccessToEpisode } from '../src/lib/access-control.js';

const prisma = new PrismaClient();

describe('hasAccessToEpisode', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeSeries(freeEpisodeCount = 2) {
    return prisma.series.create({ data: { title: 'Test Series', freeEpisodeCount } });
  }

  it('allows anonymous access to a free episode', async () => {
    const series = await makeSeries(2);
    const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 1 }, series);
    expect(allowed).toBe(true);
  });

  it('denies anonymous access to a locked episode', async () => {
    const series = await makeSeries(2);
    const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('denies a logged-in user with no membership or unlock', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('allows a user with an active membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });
    await prisma.membership.create({
      data: { userId: user.id, planId: plan.id, endAt: new Date(Date.now() + 1000 * 60 * 60) },
    });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(true);
  });

  it('denies a user with an expired membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });
    await prisma.membership.create({
      data: { userId: user.id, planId: plan.id, endAt: new Date(Date.now() - 1000) },
    });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('allows a user with a series unlock, even without membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    await prisma.seriesUnlock.create({ data: { userId: user.id, seriesId: series.id } });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- access-control.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/lib/access-control.ts
import { PrismaClient } from '@prisma/client';

export async function hasAccessToEpisode(
  prisma: PrismaClient,
  userId: string | undefined,
  episode: { episodeNumber: number },
  series: { id: string; freeEpisodeCount: number }
): Promise<boolean> {
  if (episode.episodeNumber <= series.freeEpisodeCount) {
    return true;
  }
  if (!userId) {
    return false;
  }
  const activeMembership = await prisma.membership.findFirst({
    where: { userId, endAt: { gt: new Date() } },
  });
  if (activeMembership) {
    return true;
  }
  const unlock = await prisma.seriesUnlock.findUnique({
    where: { userId_seriesId: { userId, seriesId: series.id } },
  });
  return unlock !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- access-control.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/access-control.ts apps/api/test/access-control.test.ts
git commit -m "feat(api): access control helper for episode playback"
```

---

### Task 10: R2 client + presigned playback URL

**Files:**
- Create: `apps/api/src/lib/r2.ts`
- Test: `apps/api/test/r2.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/r2.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4'),
}));

import { getPlaybackUrl } from '../src/lib/r2.js';

describe('getPlaybackUrl', () => {
  it('returns a signed url for the given key', async () => {
    const url = await getPlaybackUrl('series/1/episode-1.mp4');
    expect(url).toBe('https://signed.example.com/video.mp4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- r2.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/lib/r2.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export async function getPlaybackUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET ?? '',
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- r2.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/r2.ts apps/api/test/r2.test.ts
git commit -m "feat(api): R2 client and presigned playback URL"
```

---

### Task 11: Playback endpoint

**Files:**
- Create: `apps/api/src/routes/playback.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/playback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/playback.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4'),
}));

import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';

const prisma = new PrismaClient();

describe('GET /api/episodes/:id/playback', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makePublishedEpisode(episodeNumber: number, freeEpisodeCount = 2) {
    const series = await prisma.series.create({ data: { title: 'Test', freeEpisodeCount, status: 'published' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber, title: `Ep ${episodeNumber}`, r2Key: 'x.mp4', status: 'published' },
    });
    return { series, episode };
  }

  it('returns a playback url for a free episode with no auth header', async () => {
    const { episode } = await makePublishedEpisode(1);
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://signed.example.com/video.mp4');
    await app.close();
  });

  it('returns 403 locked for a paid episode with no auth header', async () => {
    const { episode } = await makePublishedEpisode(3);
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('locked');
    await app.close();
  });

  it('returns a playback url for a paid episode when the user has an active membership', async () => {
    const { episode } = await makePublishedEpisode(3);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });
    await prisma.membership.create({ data: { userId: user.id, planId: plan.id, endAt: new Date(Date.now() + 100000) } });

    const app = buildApp({ prisma });
    const token = app.jwt.sign({ sub: user.id, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/episodes/${episode.id}/playback`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('returns 404 for an unpublished episode', async () => {
    const series = await prisma.series.create({ data: { title: 'Test', status: 'published' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', r2Key: 'x.mp4', status: 'draft' },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- playback.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Create the playback route**

```ts
// apps/api/src/routes/playback.ts
import { FastifyInstance } from 'fastify';
import { optionalUser } from '../middleware/optional-user.js';
import { hasAccessToEpisode } from '../lib/access-control.js';
import { getPlaybackUrl } from '../lib/r2.js';

export async function playbackRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/api/episodes/:id/playback',
    { preHandler: optionalUser },
    async (request, reply) => {
      const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
      if (!episode || episode.status !== 'published') {
        return reply.code(404).send({ error: 'not_found' });
      }
      const series = await app.prisma.series.findUnique({ where: { id: episode.seriesId } });
      if (!series || series.status !== 'published') {
        return reply.code(404).send({ error: 'not_found' });
      }
      const allowed = await hasAccessToEpisode(app.prisma, request.currentUser?.id, episode, series);
      if (!allowed) {
        return reply.code(403).send({ error: 'locked' });
      }
      const url = await getPlaybackUrl(episode.r2Key);
      return { url, expiresIn: 300 };
    }
  );
}
```

- [ ] **Step 4: Register the route in `app.ts`**

```ts
import { playbackRoutes } from './routes/playback.js';
```

```ts
  app.register(episodeRoutes);
  app.register(playbackRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- playback.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/playback.ts apps/api/src/app.ts apps/api/test/playback.test.ts
git commit -m "feat(api): playback endpoint with access control and signed URL"
```

---

### Task 12: Manual grant endpoints (membership + series unlock)

**Files:**
- Create: `apps/api/src/routes/grants.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/grants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/grants.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'secret123' } });
  return res.json().token as string;
}

describe('grant routes', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('grants a membership to a user', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/membership',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, planId: plan.id },
    });
    expect(res.statusCode).toBe(200);
    const count = await prisma.membership.count({ where: { userId: user.id } });
    expect(count).toBe(1);
    await app.close();
  });

  it('returns 404 for an unknown plan', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/membership',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, planId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('grants a series unlock to a user, idempotently', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const series = await prisma.series.create({ data: { title: 'Test' } });

    await app.inject({
      method: 'POST',
      url: '/api/admin/grants/series-unlock',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, seriesId: series.id },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/series-unlock',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, seriesId: series.id },
    });
    expect(res.statusCode).toBe(200);
    const count = await prisma.seriesUnlock.count({ where: { userId: user.id, seriesId: series.id } });
    expect(count).toBe(1);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- grants.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Create the grant routes**

```ts
// apps/api/src/routes/grants.ts
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

export async function grantRoutes(app: FastifyInstance) {
  app.post<{ Body: { userId: string; planId: string } }>(
    '/api/admin/grants/membership',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { userId, planId } = request.body;
      const plan = await app.prisma.membershipPlan.findUnique({ where: { id: planId } });
      if (!plan) return reply.code(404).send({ error: 'plan_not_found' });
      const startAt = new Date();
      const endAt = new Date(startAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
      return app.prisma.membership.create({ data: { userId, planId, startAt, endAt, source: 'manual' } });
    }
  );

  app.post<{ Body: { userId: string; seriesId: string } }>(
    '/api/admin/grants/series-unlock',
    { preHandler: requireAdmin },
    async (request) => {
      const { userId, seriesId } = request.body;
      return app.prisma.seriesUnlock.upsert({
        where: { userId_seriesId: { userId, seriesId } },
        create: { userId, seriesId, source: 'manual' },
        update: {},
      });
    }
  );
}
```

- [ ] **Step 4: Register the route in `app.ts`**

```ts
import { grantRoutes } from './routes/grants.js';
```

```ts
  app.register(playbackRoutes);
  app.register(grantRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- grants.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full API test suite**

Run: `pnpm --filter api test`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/grants.ts apps/api/src/app.ts apps/api/test/grants.test.ts
git commit -m "feat(api): manual membership and series-unlock grant endpoints"
```

---

### Task 13: Local uploader CLI tool

This tool runs on your local machine, not the VPS. It shells out to `ffmpeg`/`ffprobe`, so it has no automated test in this plan — verify it manually with a short sample clip in Step 5.

**Files:**
- Create: `tools/uploader/package.json`
- Create: `tools/uploader/tsconfig.json`
- Create: `tools/uploader/.env.example`
- Create: `tools/uploader/src/upload.ts`

- [ ] **Step 1: Create `tools/uploader/package.json`**

```json
{
  "name": "uploader",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "upload": "tsx src/upload.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0"
  }
}
```

- [ ] **Step 2: Create `tools/uploader/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tools/uploader/.env.example`**

```
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=short-drama
API_BASE_URL=http://your-vps-ip:3001
ADMIN_TOKEN=
```

`ADMIN_TOKEN` is obtained by calling `POST /api/admin/login` once and pasting the returned token here (it's valid for 12h — refresh as needed while doing a batch of uploads).

- [ ] **Step 4: Create `tools/uploader/src/upload.ts`**

```ts
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

interface Args {
  file: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) throw new Error(`missing ${flag}`);
    return argv[idx + 1];
  };
  return {
    file: get('--file'),
    seriesId: get('--series-id'),
    episodeNumber: Number(get('--episode')),
    title: get('--title'),
  };
}

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', input,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', output,
    ]);
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    let out = '';
    proc.stdout.on('data', (chunk) => (out += chunk));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      resolve(Math.round(Number(out.trim())));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.join(path.dirname(args.file), `${path.parse(args.file).name}-encoded.mp4`);

  console.log('Transcoding...');
  await runFfmpeg(args.file, outputPath);

  const durationSeconds = await probeDuration(outputPath);
  const r2Key = `series/${args.seriesId}/episode-${args.episodeNumber}.mp4`;

  console.log('Uploading to R2...');
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  const body = await readFile(outputPath);
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET ?? '',
    Key: r2Key,
    Body: body,
    ContentType: 'video/mp4',
  }));

  console.log('Registering episode via admin API...');
  const res = await fetch(`${process.env.API_BASE_URL}/api/admin/episodes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
    },
    body: JSON.stringify({
      seriesId: args.seriesId,
      episodeNumber: args.episodeNumber,
      title: args.title,
      r2Key,
      durationSeconds,
    }),
  });
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  console.log('Done:', await res.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Manually verify with a short sample clip**

```bash
cp tools/uploader/.env.example tools/uploader/.env
# fill in R2 credentials, API_BASE_URL, and a fresh ADMIN_TOKEN in .env
pnpm --filter uploader upload -- --file ./sample.mp4 --series-id <a-real-series-id> --episode 1 --title "第1集"
```
Expected: console logs "Transcoding...", "Uploading to R2...", "Registering episode via admin API...", then "Done: { ... }" with the created episode JSON. Confirm the object appears in the R2 bucket and the episode appears via `GET /api/admin/series/:id/episodes`.

- [ ] **Step 6: Commit**

```bash
git add tools/uploader
git commit -m "feat(uploader): local ffmpeg transcode + R2 upload + episode registration CLI"
```

---

### Task 14: Next.js web scaffold + API client

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/lib/api-client.ts`
- Create: `apps/web/lib/liff-mock.ts`
- Create: `apps/web/.env.local.example`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "web",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;
```

- [ ] **Step 4: Create `apps/web/.env.local.example`**

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Copy to `apps/web/.env.local` for local dev.

- [ ] **Step 5: Create `apps/web/app/layout.tsx`**

```tsx
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

- [ ] **Step 6: Create `apps/web/lib/api-client.ts`**

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export interface Series {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
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

- [ ] **Step 7: Create `apps/web/lib/liff-mock.ts`**

This stands in for real LIFF login until a domain is registered with LINE. It reuses the same fake `lineUid` across sessions (via `localStorage`) so repeated logins hit the same test user, matching real LIFF behavior.

```ts
'use client';

const TOKEN_KEY = 'sd_user_token';
const UID_KEY = 'sd_dev_line_uid';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

function getOrCreateDevLineUid(): string {
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export async function mockLineLogin(): Promise<string> {
  const lineUid = getOrCreateDevLineUid();
  const res = await fetch(`${API_BASE_URL}/api/auth/line`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUid, nickname: '测试用户' }),
  });
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/next.config.js apps/web/app/layout.tsx apps/web/lib apps/web/.env.local.example
git commit -m "feat(web): scaffold next.js app, api client, and mock LINE login"
```

---

### Task 15: Homepage (series list)

**Files:**
- Create: `apps/web/app/page.tsx`

- [ ] **Step 1: Create the homepage**

```tsx
// apps/web/app/page.tsx
import Link from 'next/link';
import { fetchSeriesList } from '@/lib/api-client';

export default async function HomePage() {
  const seriesList = await fetchSeriesList();
  return (
    <main style={{ padding: 24 }}>
      <h1>短剧馆</h1>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }}>
        {seriesList.map((series) => (
          <li key={series.id}>
            <Link href={`/series/${series.id}`}>
              <h2>{series.title}</h2>
              {series.description && <p>{series.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
      {seriesList.length === 0 && <p>暂无上架剧集</p>}
    </main>
  );
}
```

- [ ] **Step 2: Manually verify**

With the API running (`pnpm dev:api`) and at least one published series seeded (use the admin API from Task 7's manual testing, or the admin panel once Task 18 is done), run `pnpm dev:web` and open `http://localhost:3000`.
Expected: page lists every published series title; clicking one navigates to `/series/:id` (404 until Task 16 exists — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): homepage series list"
```

---

### Task 16: Series detail page — episodes, mock login, playback, paywall

**Files:**
- Create: `apps/web/app/series/[id]/page.tsx`

- [ ] **Step 1: Create the series detail page**

```tsx
// apps/web/app/series/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchEpisodes, fetchPlaybackUrl, Episode } from '@/lib/api-client';
import { getStoredToken, mockLineLogin } from '@/lib/liff-mock';

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetchEpisodes(params.id).then(setEpisodes);
  }, [params.id]);

  async function play(episodeId: string) {
    setLocked(false);
    setPlaybackUrl(null);
    const token = getStoredToken() ?? undefined;
    const result = await fetchPlaybackUrl(episodeId, token);
    if ('locked' in result) {
      setLocked(true);
      return;
    }
    setPlaybackUrl(result.url);
  }

  async function login() {
    await mockLineLogin();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>剧集列表</h1>
      <ul>
        {episodes.map((ep) => (
          <li key={ep.id}>
            <button onClick={() => play(ep.id)}>
              第{ep.episodeNumber}集 {ep.title}
            </button>
          </li>
        ))}
      </ul>
      {playbackUrl && <video controls width={640} src={playbackUrl} />}
      {locked && (
        <div>
          <p>这一集需要登录后解锁/开通会员才能观看。</p>
          <button onClick={login}>LINE 登录（开发模拟）</button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manually verify the full free → locked → login → unlocked flow**

1. Seed a published series with `freeEpisodeCount: 2` and 3 published episodes (via admin API/panel).
2. Open `http://localhost:3000/series/<id>`, click episode 1 → video element appears with a playable signed URL.
3. Click episode 3 → paywall message + "LINE 登录（开发模拟）" button appears instead.
4. Click the mock login button, then use the admin panel/API to grant that user (check `localStorage sd_dev_line_uid` for the fake UID, look it up via `prisma.user.findUnique`) either a membership or a series unlock.
5. Click episode 3 again → video element appears.

Expected: all five steps behave as described.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/series
git commit -m "feat(web): series detail page with playback and paywall"
```

---

### Task 17: Admin login page

**Files:**
- Create: `apps/web/app/admin/login/page.tsx`

- [ ] **Step 1: Create the admin login page**

```tsx
// apps/web/app/admin/login/page.tsx
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
    <form onSubmit={submit} style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 320 }}>
      <h1>管理员登录</h1>
      <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit">登录</button>
    </form>
  );
}
```

- [ ] **Step 2: Manually verify**

Run `pnpm dev:web`, open `http://localhost:3000/admin/login`, log in with the seed admin credentials (`SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` from `apps/api/.env`).
Expected: successful login redirects to `/admin` (404 until Task 18 — fine for now); wrong credentials show "登录失败".

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/login
git commit -m "feat(web): admin login page"
```

---

### Task 18: Admin dashboard — series list, create, publish, manual grant

**Files:**
- Create: `apps/web/app/admin/page.tsx`

- [ ] **Step 1: Create the admin dashboard**

```tsx
// apps/web/app/admin/page.tsx
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

  return (
    <main style={{ padding: 24, display: 'grid', gap: 24 }}>
      <h1>管理后台</h1>

      <section>
        <h2>新建剧集</h2>
        <form onSubmit={createSeries} style={{ display: 'flex', gap: 8 }}>
          <input placeholder="剧名" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">创建</button>
        </form>
      </section>

      <section>
        <h2>剧集列表</h2>
        <ul>
          {seriesList.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/series/${s.id}`}>{s.title}</Link> — {s.status} — 免费{s.freeEpisodeCount}集 — 解锁价NT${(s.unlockPriceCents / 100).toFixed(0)}
              {s.status !== 'published' && (
                <button onClick={() => publishSeries(s.id)} style={{ marginLeft: 8 }}>
                  上架
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>手动开通剧集解锁</h2>
        <form onSubmit={grantSeriesUnlock} style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
          <input placeholder="User ID" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} />
          <input placeholder="Series ID" value={grantSeriesId} onChange={(e) => setGrantSeriesId(e.target.value)} />
          <button type="submit">解锁</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Manually verify**

Log in at `/admin/login`, then on `/admin`: create a series, confirm it shows status `draft`, click "上架" and confirm status flips to `published` (and it now shows on the public homepage from Task 15). Fill in a real user ID and series ID in the grant form, submit, and confirm via `prisma.seriesUnlock.findMany` (or re-running Task 16's playback flow) that the unlock took effect.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/page.tsx
git commit -m "feat(web): admin dashboard for series management and manual unlocks"
```

---

### Task 19: Admin episode management page

**Files:**
- Create: `apps/web/app/admin/series/[id]/page.tsx`

- [ ] **Step 1: Create the episode management page**

```tsx
// apps/web/app/admin/series/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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
    <main style={{ padding: 24 }}>
      <h1>集数管理</h1>
      <p>新增集数请用本地上传工具（<code>tools/uploader</code>）注册，这里只负责上下架。</p>
      <ul>
        {episodes.map((ep) => (
          <li key={ep.id}>
            第{ep.episodeNumber}集 {ep.title} — {ep.status}
            {ep.status !== 'published' && (
              <button onClick={() => publish(ep.id)} style={{ marginLeft: 8 }}>
                上架
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manually verify the end-to-end content pipeline**

1. Run the uploader tool (Task 13) against a sample clip for a series created in Task 18.
2. Open `/admin/series/<id>` and confirm the episode shows up with status `draft`.
3. Click "上架" and confirm status becomes `published`.
4. Open the public `/series/<id>` page and confirm the episode now appears and, if within the free count, plays immediately.

Expected: all four steps behave as described — this is the full content pipeline from raw file to a watchable episode.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/series
git commit -m "feat(web): admin episode publish management page"
```

---

## Self-review notes

- **Spec coverage:** LINE login (mocked, Task 6 + 16), homepage (Task 15), admin video upload (Task 13 uploader + Task 19 publish UI), monthly membership (Task 2 seed plan + Task 9 access logic + Task 12/18 manual grant UI), payment deliberately deferred (manual grants stand in, noted in Tasks 12 and 18) — all covered.
- **No placeholders:** every step has real, complete code; the one open TODO-shaped item (LIFF ID token verification) is explicitly called out as future/production work in Task 6, not left as a silent gap.
- **Type consistency:** `hasAccessToEpisode(prisma, userId, episode, series)` signature (Task 9) matches its call site in `playback.ts` (Task 11); `SeriesBody`/`CreateEpisodeBody` field names match between route handlers and the tests that exercise them.

---

## What's explicitly out of scope for this plan

- Real payment integration (绿界/蓝新) — replaces the manual grant endpoints later without changing the access-control logic.
- Real LIFF ID token verification — replaces the trust-the-client-uid logic in `user-auth.ts` once a domain + LIFF app exist.
- HLS multi-bitrate transcoding — the uploader currently produces a single MP4 per episode; swapping in HLS only changes Task 13's `runFfmpeg` call and the `r2Key` convention, not the access-control or playback-URL architecture.
- Concurrent-session/device limits for membership sharing abuse — deferred until real usage data justifies it.
