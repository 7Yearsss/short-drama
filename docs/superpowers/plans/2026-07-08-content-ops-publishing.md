# Content Operations Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the content-operations publishing upgrade: safer series publishing, ongoing episode updates, free-series access, offline states, safe video replacement, admin filtering/sorting, and lightweight audit logs.

**Architecture:** Extend the existing Fastify + Prisma API with small domain helpers for publish checks and audit logging, then update the existing admin pages instead of introducing a new CMS layer. Video replacement reuses the current upload queue shape with a job mode that writes to replacement fields until an admin confirms the swap. The public site continues to consume REST endpoints from `apps/web/lib/api-client.ts`.

**Tech Stack:** Node.js 20, TypeScript, Fastify, Prisma/PostgreSQL, Vitest, Next.js 14 App Router, React, existing R2 signing/upload helpers.

---

## File Structure

Backend files to modify:

- `apps/api/prisma/schema.prisma` — add publishing fields, replacement fields, and `AdminAuditLog`.
- `apps/api/test/helpers/clean-db.ts` — delete audit logs during test cleanup.
- `apps/api/src/lib/audit-log.ts` — new helper for recording admin content actions.
- `apps/api/src/lib/publish-checks.ts` — new helper for series publish hard blockers and warnings.
- `apps/api/src/lib/access-control.ts` — add free-series access rule.
- `apps/api/src/lib/upload-queue.ts` — support normal episode uploads and replacement-video uploads.
- `apps/api/src/routes/series.ts` — admin filtering/sorting, public sorting, publish checks, publish/offline helpers, audit logging.
- `apps/api/src/routes/episodes.ts` — publish/offline behavior, replacement upload/preview/confirm/abandon routes, audit logging.
- `apps/api/src/routes/playback.ts` — continue using formal `r2Key`; no replacement preview leakage through public playback.

Backend tests to create or modify:

- `apps/api/test/access-control.test.ts`
- `apps/api/test/playback.test.ts`
- `apps/api/test/series.test.ts`
- `apps/api/test/episodes.test.ts`
- `apps/api/test/episodes-upload.test.ts`
- `apps/api/test/upload-queue.test.ts`
- `apps/api/test/audit-log.test.ts`

Frontend files to modify:

- `apps/web/lib/api-client.ts` — expose new fields used by public pages.
- `apps/web/app/page.tsx` — show free/paid and update-status labels.
- `apps/web/app/series/[id]/page.tsx` — stop marking free-series episodes as locked.
- `apps/web/app/admin/page.tsx` — add search, filters, sorting fields, and status labels.
- `apps/web/app/admin/series/[id]/page.tsx` — upgrade to single-series operations workbench.
- `apps/web/app/globals.css` — small layout and status styles for new controls if needed.

Frontend tests to create or modify:

- `apps/web/test/admin-series-actions.test.mjs`
- `apps/web/test/public-series-display.test.mjs`

---

### Task 1: Data Model for Publishing, Replacement, and Audit Logs

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/test/helpers/clean-db.ts`

- [ ] **Step 1: Update Prisma schema**

Add fields to `Series`, `Episode`, and the new `AdminAuditLog` model:

```prisma
model Admin {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())

  auditLogs AdminAuditLog[]
}

model Series {
  id                     String   @id @default(uuid())
  title                  String
  description            String?
  coverUrl               String?
  freeEpisodeCount       Int      @default(2)
  unlockPriceCents       Int      @default(9900)
  status                 String   @default("draft")
  updateStatus           String   @default("ongoing")
  sortOrder              Int      @default(0)
  lastPublishedEpisodeAt DateTime?
  publishedAt            DateTime?
  offlineAt              DateTime?
  createdAt              DateTime @default(now())

  episodes      Episode[]
  seriesUnlocks SeriesUnlock[]
  auditLogs     AdminAuditLog[]
}

model Episode {
  id                         String   @id @default(uuid())
  seriesId                   String
  episodeNumber              Int
  title                      String
  r2Key                      String?
  durationSeconds            Int?
  status                     String   @default("draft")
  uploadError                String?
  tempVideoPath              String?
  replacementR2Key           String?
  replacementDurationSeconds Int?
  replacementStatus          String?
  replacementUploadError     String?
  replacementTempVideoPath   String?
  publishedAt                DateTime?
  offlineAt                  DateTime?
  createdAt                  DateTime @default(now())

  series Series @relation(fields: [seriesId], references: [id])

  @@unique([seriesId, episodeNumber])
}

model AdminAuditLog {
  id         String   @id @default(uuid())
  adminId    String
  action     String
  targetType String
  targetId   String
  seriesId   String?
  metadata   Json?
  createdAt  DateTime @default(now())

  admin  Admin   @relation(fields: [adminId], references: [id])
  series Series? @relation(fields: [seriesId], references: [id])

  @@index([seriesId, createdAt])
  @@index([adminId, createdAt])
}
```

- [ ] **Step 2: Create migration**

Run:

```bash
pnpm --filter api exec prisma migrate dev --name content_ops_publishing
```

Expected: Prisma creates a migration under `apps/api/prisma/migrations/*_content_ops_publishing/`.

- [ ] **Step 3: Update test cleanup**

In `apps/api/test/helpers/clean-db.ts`, delete audit logs before deleting admins and series-linked data:

```ts
import { PrismaClient } from '@prisma/client';

export async function cleanDb(prisma: PrismaClient) {
  await prisma.adminAuditLog.deleteMany();
  await prisma.seriesUnlock.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.series.deleteMany();
  await prisma.membershipPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
}
```

- [ ] **Step 4: Verify Prisma client generation**

Run:

```bash
pnpm --filter api exec prisma generate
pnpm --filter api exec tsc -p tsconfig.json --noEmit
```

Expected: both commands complete without TypeScript or Prisma errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/helpers/clean-db.ts
git commit -m "feat(api): add content publishing data model"
```

---

### Task 2: Audit Log Helper

**Files:**
- Create: `apps/api/src/lib/audit-log.ts`
- Test: `apps/api/test/audit-log.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/audit-log.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { cleanDb } from './helpers/clean-db.js';
import { recordAdminAuditLog } from '../src/lib/audit-log.js';

const prisma = new PrismaClient();

describe('recordAdminAuditLog', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records a content operation for a series', async () => {
    const admin = await prisma.admin.create({ data: { username: 'boss', passwordHash: 'hash' } });
    const series = await prisma.series.create({ data: { title: 'Test Series' } });

    await recordAdminAuditLog(prisma, {
      adminId: admin.id,
      action: 'series.publish',
      targetType: 'series',
      targetId: series.id,
      seriesId: series.id,
      metadata: { from: 'draft', to: 'published' },
    });

    const log = await prisma.adminAuditLog.findFirstOrThrow();
    expect(log.adminId).toBe(admin.id);
    expect(log.action).toBe('series.publish');
    expect(log.targetType).toBe('series');
    expect(log.targetId).toBe(series.id);
    expect(log.seriesId).toBe(series.id);
    expect(log.metadata).toEqual({ from: 'draft', to: 'published' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter api test -- audit-log.test.ts
```

Expected: FAIL because `../src/lib/audit-log.js` does not exist.

- [ ] **Step 3: Implement helper**

Create `apps/api/src/lib/audit-log.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

export interface AuditLogInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  seriesId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAdminAuditLog(prisma: PrismaClient, input: AuditLogInput) {
  return prisma.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      seriesId: input.seriesId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter api test -- audit-log.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/audit-log.ts apps/api/test/audit-log.test.ts
git commit -m "feat(api): add admin audit log helper"
```

---

### Task 3: Free-Series Access and Public Filtering

**Files:**
- Modify: `apps/api/src/lib/access-control.ts`
- Modify: `apps/api/src/routes/series.ts`
- Modify: `apps/api/test/access-control.test.ts`
- Modify: `apps/api/test/playback.test.ts`
- Modify: `apps/api/test/series.test.ts`

- [ ] **Step 1: Add failing access-control tests**

In `apps/api/test/access-control.test.ts`, add:

```ts
it('allows every episode of a free series without login', async () => {
  const series = await prisma.series.create({
    data: { title: 'Free Show', freeEpisodeCount: 0, unlockPriceCents: 0 },
  });

  const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 99 }, series);

  expect(allowed).toBe(true);
});
```

- [ ] **Step 2: Add failing playback and public route tests**

In `apps/api/test/playback.test.ts`, add:

```ts
it('returns a playback url for any published episode of a free series', async () => {
  const series = await prisma.series.create({
    data: { title: 'Free Test', status: 'published', unlockPriceCents: 0, freeEpisodeCount: 0 },
  });
  const episode = await prisma.episode.create({
    data: { seriesId: series.id, episodeNumber: 20, title: 'Ep 20', r2Key: 'free.mp4', status: 'published' },
  });

  const app = buildApp({ prisma });
  const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });

  expect(res.statusCode).toBe(200);
  expect(res.json().url).toBe('https://signed.example.com/video.mp4');
  await app.close();
});

it('returns 404 when the parent series is offline', async () => {
  const series = await prisma.series.create({ data: { title: 'Offline Test', status: 'offline' } });
  const episode = await prisma.episode.create({
    data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', r2Key: 'x.mp4', status: 'published' },
  });

  const app = buildApp({ prisma });
  const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });

  expect(res.statusCode).toBe(404);
  await app.close();
});
```

In `apps/api/test/series.test.ts`, add:

```ts
it('does not list offline series on the public endpoint', async () => {
  await prisma.series.create({ data: { title: 'Hidden', status: 'offline' } });
  const app = buildApp({ prisma });
  const res = await app.inject({ method: 'GET', url: '/api/series' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([]);
  await app.close();
});

it('orders public series by sortOrder, lastPublishedEpisodeAt, then createdAt', async () => {
  const older = new Date('2026-01-01T00:00:00.000Z');
  const newer = new Date('2026-01-02T00:00:00.000Z');
  await prisma.series.create({
    data: { title: 'Recent', status: 'published', sortOrder: 0, lastPublishedEpisodeAt: newer },
  });
  await prisma.series.create({
    data: { title: 'Pinned', status: 'published', sortOrder: 10, lastPublishedEpisodeAt: older },
  });

  const app = buildApp({ prisma });
  const res = await app.inject({ method: 'GET', url: '/api/series' });

  expect(res.json().map((series: { title: string }) => series.title)).toEqual(['Pinned', 'Recent']);
  await app.close();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter api test -- access-control.test.ts playback.test.ts series.test.ts
```

Expected: FAIL for free-series access and public sorting until implementation is added.

- [ ] **Step 4: Implement access and public ordering**

Update `apps/api/src/lib/access-control.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export async function hasAccessToEpisode(
  prisma: PrismaClient,
  userId: string | undefined,
  episode: { episodeNumber: number },
  series: { id: string; freeEpisodeCount: number; unlockPriceCents: number }
): Promise<boolean> {
  if (series.unlockPriceCents === 0) {
    return true;
  }
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

Update the public list in `apps/api/src/routes/series.ts`:

```ts
app.get('/api/series', async () => {
  return app.prisma.series.findMany({
    where: { status: 'published' },
    orderBy: [{ sortOrder: 'desc' }, { lastPublishedEpisodeAt: 'desc' }, { createdAt: 'desc' }],
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm --filter api test -- access-control.test.ts playback.test.ts series.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/access-control.ts apps/api/src/routes/series.ts apps/api/test/access-control.test.ts apps/api/test/playback.test.ts apps/api/test/series.test.ts
git commit -m "feat(api): support free series playback and public ordering"
```

---

### Task 4: Series Publish Checks, Admin Filters, Status Transitions

**Files:**
- Create: `apps/api/src/lib/publish-checks.ts`
- Modify: `apps/api/src/routes/series.ts`
- Modify: `apps/api/test/series.test.ts`

- [ ] **Step 1: Add failing series route tests**

Add tests to `apps/api/test/series.test.ts`:

```ts
it('returns publish checks with blockers and warnings', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  const series = await prisma.series.create({
    data: { title: 'No Cover', description: null, coverUrl: null, freeEpisodeCount: 5 },
  });
  await prisma.episode.create({
    data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'failed', uploadError: 'bad file' },
  });

  const res = await app.inject({
    method: 'GET',
    url: `/api/admin/series/${series.id}/publish-checks`,
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    blockers: [{ code: 'missing_cover', message: '请先上传封面' }],
    warnings: expect.arrayContaining([
      { code: 'missing_description', message: '建议补充简介' },
      { code: 'has_failed_episodes', message: '存在转码失败的集数' },
      { code: 'free_count_exceeds_published', message: '免费集数大于当前已上架集数' },
    ]),
  });
  await app.close();
});

it('blocks publishing a series when hard publish checks fail', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  const series = await prisma.series.create({ data: { title: 'No Cover' } });

  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/series/${series.id}/publish`,
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('publish_blocked');
  expect(res.json().blockers).toEqual(expect.arrayContaining([{ code: 'missing_cover', message: '请先上传封面' }]));
  await app.close();
});

it('publishes and offlines a series with audit logs', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  const series = await prisma.series.create({ data: { title: 'Ready', coverUrl: 'https://img.example/cover.jpg' } });
  await prisma.episode.create({
    data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'draft', r2Key: 'x.mp4' },
  });

  const publishRes = await app.inject({
    method: 'POST',
    url: `/api/admin/series/${series.id}/publish`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(publishRes.statusCode).toBe(200);
  expect(publishRes.json().status).toBe('published');
  expect(publishRes.json().publishedAt).toBeTypeOf('string');

  const offlineRes = await app.inject({
    method: 'POST',
    url: `/api/admin/series/${series.id}/offline`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(offlineRes.statusCode).toBe(200);
  expect(offlineRes.json().status).toBe('offline');

  const logs = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
  expect(logs.map((log) => log.action)).toEqual(['series.publish', 'series.offline']);
  await app.close();
});

it('filters admin series by search, status, and update status', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  await prisma.series.create({ data: { title: '甜宠日记', status: 'published', updateStatus: 'ongoing' } });
  await prisma.series.create({ data: { title: '逆袭人生', status: 'offline', updateStatus: 'completed' } });

  const res = await app.inject({
    method: 'GET',
    url: '/api/admin/series?q=甜&status=published&updateStatus=ongoing',
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().map((series: { title: string }) => series.title)).toEqual(['甜宠日记']);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter api test -- series.test.ts
```

Expected: FAIL because publish-check and transition routes do not exist.

- [ ] **Step 3: Implement publish-check helper**

Create `apps/api/src/lib/publish-checks.ts`:

```ts
export interface PublishCheckItem {
  code: string;
  message: string;
}

export interface PublishCheckInput {
  title: string;
  description: string | null;
  coverUrl: string | null;
  unlockPriceCents: number;
  freeEpisodeCount: number;
  updateStatus: string;
  publishedEpisodeCount: number;
  draftEpisodeCount: number;
  processingEpisodeCount: number;
  failedEpisodeCount: number;
  episodeNumbers: number[];
}

export function evaluateSeriesPublishChecks(input: PublishCheckInput) {
  const blockers: PublishCheckItem[] = [];
  const warnings: PublishCheckItem[] = [];

  if (!input.title.trim()) blockers.push({ code: 'missing_title', message: '请先填写剧名' });
  if (!input.coverUrl) blockers.push({ code: 'missing_cover', message: '请先上传封面' });
  if (input.publishedEpisodeCount + input.draftEpisodeCount === 0) {
    blockers.push({ code: 'missing_episodes', message: '请先上传至少一集' });
  }
  if (input.publishedEpisodeCount === 0 && input.processingEpisodeCount > 0) {
    blockers.push({ code: 'first_publish_has_processing', message: '首批集数仍在转码中' });
  }
  if (input.unlockPriceCents > 0 && input.freeEpisodeCount < 0) {
    blockers.push({ code: 'invalid_free_episode_count', message: '免费集数不能小于 0' });
  }

  if (!input.description?.trim()) warnings.push({ code: 'missing_description', message: '建议补充简介' });
  if (input.failedEpisodeCount > 0) warnings.push({ code: 'has_failed_episodes', message: '存在转码失败的集数' });
  if (hasGap(input.episodeNumbers)) warnings.push({ code: 'episode_number_gap', message: '集数不连续' });
  if (input.unlockPriceCents > 0 && input.freeEpisodeCount > input.publishedEpisodeCount) {
    warnings.push({ code: 'free_count_exceeds_published', message: '免费集数大于当前已上架集数' });
  }
  if (input.updateStatus === 'completed' && input.episodeNumbers.length < 3) {
    warnings.push({ code: 'completed_with_few_episodes', message: '已完结剧集的集数较少' });
  }

  return { blockers, warnings };
}

function hasGap(numbers: number[]): boolean {
  if (numbers.length <= 1) return false;
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] !== sorted[index - 1] + 1) return true;
  }
  return false;
}
```

- [ ] **Step 4: Implement routes**

In `apps/api/src/routes/series.ts`, add:

```ts
import { Prisma } from '@prisma/client';
import { evaluateSeriesPublishChecks } from '../lib/publish-checks.js';
import { recordAdminAuditLog } from '../lib/audit-log.js';
```

Add helpers inside the file:

```ts
async function buildPublishChecks(app: FastifyInstance, seriesId: string) {
  const series = await app.prisma.series.findUnique({ where: { id: seriesId } });
  if (!series) return null;
  const episodes = await app.prisma.episode.findMany({ where: { seriesId }, orderBy: { episodeNumber: 'asc' } });
  return {
    series,
    checks: evaluateSeriesPublishChecks({
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      unlockPriceCents: series.unlockPriceCents,
      freeEpisodeCount: series.freeEpisodeCount,
      updateStatus: series.updateStatus,
      publishedEpisodeCount: episodes.filter((episode) => episode.status === 'published').length,
      draftEpisodeCount: episodes.filter((episode) => episode.status === 'draft').length,
      processingEpisodeCount: episodes.filter((episode) => episode.status === 'processing').length,
      failedEpisodeCount: episodes.filter((episode) => episode.status === 'failed').length,
      episodeNumbers: episodes.map((episode) => episode.episodeNumber),
    }),
  };
}
```

Replace the admin list route with query-aware filtering:

```ts
app.get<{ Querystring: { q?: string; status?: string; updateStatus?: string } }>(
  '/api/admin/series',
  { preHandler: requireAdmin },
  async (request) => {
    const where: Prisma.SeriesWhereInput = {};
    if (request.query.q?.trim()) {
      where.title = { contains: request.query.q.trim(), mode: 'insensitive' };
    }
    if (request.query.status && request.query.status !== 'all') {
      where.status = request.query.status;
    }
    if (request.query.updateStatus && request.query.updateStatus !== 'all') {
      where.updateStatus = request.query.updateStatus;
    }
    return app.prisma.series.findMany({
      where,
      orderBy: [{ sortOrder: 'desc' }, { lastPublishedEpisodeAt: 'desc' }, { createdAt: 'desc' }],
    });
  }
);
```

Add publish-check, publish, and offline routes:

```ts
app.get<{ Params: { id: string } }>(
  '/api/admin/series/:id/publish-checks',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const result = await buildPublishChecks(app, request.params.id);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result.checks;
  }
);

app.post<{ Params: { id: string } }>(
  '/api/admin/series/:id/publish',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const result = await buildPublishChecks(app, request.params.id);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if (result.checks.blockers.length > 0) {
      return reply.code(409).send({ error: 'publish_blocked', ...result.checks });
    }
    const now = new Date();
    const updated = await app.prisma.series.update({
      where: { id: request.params.id },
      data: { status: 'published', publishedAt: result.series.publishedAt ?? now, offlineAt: null },
    });
    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'series.publish',
      targetType: 'series',
      targetId: updated.id,
      seriesId: updated.id,
      metadata: { previousStatus: result.series.status, nextStatus: 'published' },
    });
    return updated;
  }
);

app.post<{ Params: { id: string } }>(
  '/api/admin/series/:id/offline',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const existing = await app.prisma.series.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const updated = await app.prisma.series.update({
      where: { id: request.params.id },
      data: { status: 'offline', offlineAt: new Date() },
    });
    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'series.offline',
      targetType: 'series',
      targetId: updated.id,
      seriesId: updated.id,
      metadata: { previousStatus: existing.status, nextStatus: 'offline' },
    });
    return updated;
  }
);
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter api test -- series.test.ts audit-log.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/publish-checks.ts apps/api/src/routes/series.ts apps/api/test/series.test.ts
git commit -m "feat(api): add series publish checks and status transitions"
```

---

### Task 5: Episode Publish, Offline, and Recent Update Tracking

**Files:**
- Modify: `apps/api/src/routes/episodes.ts`
- Test: `apps/api/test/episodes.test.ts`

- [ ] **Step 1: Add failing tests**

Create or extend `apps/api/test/episodes.test.ts`:

```ts
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

describe('episode publishing operations', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes a draft episode and updates series lastPublishedEpisodeAt', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'draft', r2Key: 'x.mp4' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('published');
    expect(res.json().publishedAt).toBeTypeOf('string');

    const updatedSeries = await prisma.series.findUniqueOrThrow({ where: { id: series.id } });
    expect(updatedSeries.lastPublishedEpisodeAt).toBeInstanceOf(Date);

    const logs = await prisma.adminAuditLog.findMany();
    expect(logs.map((log) => log.action)).toEqual(['episode.publish']);
    await app.close();
  });

  it('does not publish an episode without a video key', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'draft', r2Key: null },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'video_not_uploaded' });
    await app.close();
  });

  it('offlines a published episode and hides it from the public episode list', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series', status: 'published' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'published', r2Key: 'x.mp4' },
    });

    const offlineRes = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/offline`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(offlineRes.statusCode).toBe(200);
    expect(offlineRes.json().status).toBe('offline');

    const publicRes = await app.inject({ method: 'GET', url: `/api/series/${series.id}/episodes` });
    expect(publicRes.json()).toEqual([]);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter api test -- episodes.test.ts
```

Expected: FAIL because publish/offline episode routes do not exist.

- [ ] **Step 3: Implement routes**

In `apps/api/src/routes/episodes.ts`, import audit logging:

```ts
import { recordAdminAuditLog } from '../lib/audit-log.js';
```

Add routes before the generic `PATCH /api/admin/episodes/:id` route:

```ts
app.post<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/publish',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const existing = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (!existing.r2Key) return reply.code(409).send({ error: 'video_not_uploaded' });

    const now = new Date();
    const updated = await app.prisma.$transaction(async (tx) => {
      const episode = await tx.episode.update({
        where: { id: existing.id },
        data: { status: 'published', publishedAt: existing.publishedAt ?? now, offlineAt: null },
      });
      await tx.series.update({
        where: { id: existing.seriesId },
        data: { lastPublishedEpisodeAt: now },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: request.currentAdmin!.id,
          action: 'episode.publish',
          targetType: 'episode',
          targetId: existing.id,
          seriesId: existing.seriesId,
          metadata: { episodeNumber: existing.episodeNumber, previousStatus: existing.status },
        },
      });
      return episode;
    });

    return updated;
  }
);

app.post<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/offline',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const existing = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const updated = await app.prisma.episode.update({
      where: { id: existing.id },
      data: { status: 'offline', offlineAt: new Date() },
    });
    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'episode.offline',
      targetType: 'episode',
      targetId: existing.id,
      seriesId: existing.seriesId,
      metadata: { episodeNumber: existing.episodeNumber, previousStatus: existing.status },
    });
    return updated;
  }
);
```

Keep the existing public episodes route constrained to published episodes:

```ts
where: { seriesId: request.params.id, status: 'published', r2Key: { not: null } }
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter api test -- episodes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/episodes.ts apps/api/test/episodes.test.ts
git commit -m "feat(api): add episode publish and offline operations"
```

---

### Task 6: Upload Queue Supports Replacement Jobs

**Files:**
- Modify: `apps/api/src/lib/upload-queue.ts`
- Modify: `apps/api/test/upload-queue.test.ts`

- [ ] **Step 1: Add failing queue tests**

In `apps/api/test/upload-queue.test.ts`, add:

```ts
it('stores replacement video output without changing the published r2Key', async () => {
  mocks.transcodeVideo.mockResolvedValue(undefined);
  mocks.probeDuration.mockResolvedValue(88);
  mocks.uploadEpisodeVideo.mockResolvedValue(undefined);
  const series = await prisma.series.create({ data: { title: 'Test Series' } });
  const episode = await prisma.episode.create({
    data: {
      seriesId: series.id,
      episodeNumber: 8,
      title: 'Ep 8',
      status: 'published',
      r2Key: 'series/original/episode-8.mp4',
      replacementStatus: 'processing',
      replacementTempVideoPath: 'C:\\tmp\\replacement-8.mp4',
    },
  });

  enqueueEpisodeUpload(prisma, {
    kind: 'replacement',
    episodeId: episode.id,
    tempVideoPath: 'C:\\tmp\\replacement-8.mp4',
    seriesId: series.id,
    episodeNumber: 8,
  });
  await waitForQueueIdle();

  const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
  expect(updated.r2Key).toBe('series/original/episode-8.mp4');
  expect(updated.replacementR2Key).toBe(`series/${series.id}/episode-8-replacement.mp4`);
  expect(updated.replacementDurationSeconds).toBe(88);
  expect(updated.replacementStatus).toBe('ready');
  expect(updated.replacementUploadError).toBeNull();
});

it('marks replacement upload failed without changing the published r2Key', async () => {
  mocks.transcodeVideo.mockRejectedValue(new Error('ffmpeg failed'));
  const series = await prisma.series.create({ data: { title: 'Test Series' } });
  const episode = await prisma.episode.create({
    data: {
      seriesId: series.id,
      episodeNumber: 8,
      title: 'Ep 8',
      status: 'published',
      r2Key: 'series/original/episode-8.mp4',
      replacementStatus: 'processing',
      replacementTempVideoPath: 'C:\\tmp\\replacement-8.mp4',
    },
  });

  enqueueEpisodeUpload(prisma, {
    kind: 'replacement',
    episodeId: episode.id,
    tempVideoPath: 'C:\\tmp\\replacement-8.mp4',
    seriesId: series.id,
    episodeNumber: 8,
  });
  await waitForQueueIdle();

  const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
  expect(updated.r2Key).toBe('series/original/episode-8.mp4');
  expect(updated.replacementStatus).toBe('failed');
  expect(updated.replacementUploadError).toContain('ffmpeg failed');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter api test -- upload-queue.test.ts
```

Expected: FAIL because `UploadJob` has no `kind` and replacement fields are not written.

- [ ] **Step 3: Implement discriminated upload jobs**

Update `apps/api/src/lib/upload-queue.ts`:

```ts
export type UploadJobKind = 'episode' | 'replacement';

export interface UploadJob {
  kind?: UploadJobKind;
  episodeId: string;
  tempVideoPath: string;
  seriesId: string;
  episodeNumber: number;
}
```

Inside `runJob`, after upload succeeds:

```ts
const kind = job.kind ?? 'episode';
const suffix = kind === 'replacement' ? '-replacement' : '';
const r2Key = `series/${job.seriesId}/episode-${job.episodeNumber}${suffix}.mp4`;
await uploadEpisodeVideo(r2Key, outputPath);

if (kind === 'replacement') {
  await prisma.episode.update({
    where: { id: job.episodeId },
    data: {
      replacementR2Key: r2Key,
      replacementDurationSeconds: durationSeconds,
      replacementStatus: 'ready',
      replacementUploadError: null,
      replacementTempVideoPath: null,
    },
  });
} else {
  await prisma.episode.update({
    where: { id: job.episodeId },
    data: {
      r2Key,
      durationSeconds,
      status: 'draft',
      uploadError: null,
      tempVideoPath: null,
    },
  });
}
```

Inside the catch block:

```ts
const kind = job.kind ?? 'episode';
if (kind === 'replacement') {
  await prisma.episode.update({
    where: { id: job.episodeId },
    data: {
      replacementStatus: 'failed',
      replacementUploadError: error instanceof Error ? error.message : String(error),
    },
  });
  return;
}
await prisma.episode.update({
  where: { id: job.episodeId },
  data: {
    status: 'failed',
    uploadError: error instanceof Error ? error.message : String(error),
  },
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter api test -- upload-queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/upload-queue.ts apps/api/test/upload-queue.test.ts
git commit -m "feat(api): support replacement video upload jobs"
```

---

### Task 7: Replacement Video API

**Files:**
- Modify: `apps/api/src/routes/episodes.ts`
- Modify: `apps/api/test/episodes-upload.test.ts`
- Modify: `apps/api/test/episodes.test.ts`

- [ ] **Step 1: Add failing replacement upload tests**

In `apps/api/test/episodes-upload.test.ts`, add:

```ts
it('uploads a replacement video without changing the current r2Key', async () => {
  const token = await adminToken(app);
  const series = await prisma.series.create({ data: { title: 'Test Series' } });
  const episode = await prisma.episode.create({
    data: { seriesId: series.id, episodeNumber: 8, title: 'Ep 8', status: 'published', r2Key: 'old.mp4' },
  });
  const multipart = await videoUploadPayload({});

  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/episodes/${episode.id}/replacement/upload`,
    headers: { authorization: `Bearer ${token}`, ...multipart.headers },
    payload: multipart.payload,
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ id: episode.id, r2Key: 'old.mp4', replacementStatus: 'processing' });
  expect(enqueueEpisodeUpload).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({ kind: 'replacement', episodeId: episode.id, seriesId: series.id, episodeNumber: 8 })
  );
});
```

In `apps/api/test/episodes.test.ts`, add:

```ts
it('previews, confirms, and abandons replacement videos', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  const series = await prisma.series.create({ data: { title: 'Test Series' } });
  const episode = await prisma.episode.create({
    data: {
      seriesId: series.id,
      episodeNumber: 8,
      title: 'Ep 8',
      status: 'published',
      r2Key: 'old.mp4',
      durationSeconds: 60,
      replacementR2Key: 'new.mp4',
      replacementDurationSeconds: 90,
      replacementStatus: 'ready',
    },
  });

  const previewRes = await app.inject({
    method: 'GET',
    url: `/api/admin/episodes/${episode.id}/replacement/preview`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(previewRes.statusCode).toBe(200);
  expect(previewRes.json().url).toBe('https://signed.example.com/video.mp4');

  const confirmRes = await app.inject({
    method: 'POST',
    url: `/api/admin/episodes/${episode.id}/replacement/confirm`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(confirmRes.statusCode).toBe(200);
  expect(confirmRes.json()).toMatchObject({
    r2Key: 'new.mp4',
    durationSeconds: 90,
    replacementR2Key: null,
    replacementStatus: null,
  });

  await prisma.episode.update({
    where: { id: episode.id },
    data: { replacementR2Key: 'newer.mp4', replacementStatus: 'ready' },
  });
  const abandonRes = await app.inject({
    method: 'POST',
    url: `/api/admin/episodes/${episode.id}/replacement/abandon`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(abandonRes.statusCode).toBe(200);
  expect(abandonRes.json().replacementR2Key).toBeNull();

  await app.close();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter api test -- episodes-upload.test.ts episodes.test.ts
```

Expected: FAIL because replacement routes do not exist.

- [ ] **Step 3: Implement replacement routes**

In `apps/api/src/routes/episodes.ts`, import preview signing:

```ts
import { getPlaybackUrl } from '../lib/r2.js';
```

Add a small multipart helper if duplication becomes noisy; keep behavior identical to normal upload: require a `video` file and reject non-video files.

Add routes:

```ts
app.post<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/replacement/upload',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!episode) return reply.code(404).send({ error: 'not_found' });
    if (episode.status !== 'published' || !episode.r2Key) {
      return reply.code(409).send({ error: 'not_published' });
    }

    const data = await request.file();
    if (!data || data.fieldname !== 'video') return reply.code(400).send({ error: 'missing_video' });
    if (!data.mimetype.startsWith('video/')) return reply.code(400).send({ error: 'invalid_video' });

    await mkdir(UPLOAD_DIR, { recursive: true });
    const tempVideoPath = path.join(UPLOAD_DIR, `${randomUUID()}.mp4`);
    await pipeline(data.file, createWriteStream(tempVideoPath));

    const updated = await app.prisma.episode.update({
      where: { id: episode.id },
      data: {
        replacementStatus: 'processing',
        replacementUploadError: null,
        replacementTempVideoPath: tempVideoPath,
        replacementR2Key: null,
        replacementDurationSeconds: null,
      },
    });

    enqueueEpisodeUpload(app.prisma, {
      kind: 'replacement',
      episodeId: episode.id,
      tempVideoPath,
      seriesId: episode.seriesId,
      episodeNumber: episode.episodeNumber,
    });

    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'episode.replacement_start',
      targetType: 'episode',
      targetId: episode.id,
      seriesId: episode.seriesId,
      metadata: { episodeNumber: episode.episodeNumber },
    });

    return updated;
  }
);

app.get<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/replacement/preview',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!episode || !episode.replacementR2Key || episode.replacementStatus !== 'ready') {
      return reply.code(404).send({ error: 'not_found' });
    }
    return { url: await getPlaybackUrl(episode.replacementR2Key), expiresIn: 300 };
  }
);

app.post<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/replacement/confirm',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!episode) return reply.code(404).send({ error: 'not_found' });
    if (!episode.replacementR2Key || episode.replacementStatus !== 'ready') {
      return reply.code(409).send({ error: 'replacement_not_ready' });
    }
    const updated = await app.prisma.episode.update({
      where: { id: episode.id },
      data: {
        r2Key: episode.replacementR2Key,
        durationSeconds: episode.replacementDurationSeconds,
        replacementR2Key: null,
        replacementDurationSeconds: null,
        replacementStatus: null,
        replacementUploadError: null,
        replacementTempVideoPath: null,
      },
    });
    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'episode.replacement_confirm',
      targetType: 'episode',
      targetId: episode.id,
      seriesId: episode.seriesId,
      metadata: { episodeNumber: episode.episodeNumber },
    });
    return updated;
  }
);

app.post<{ Params: { id: string } }>(
  '/api/admin/episodes/:id/replacement/abandon',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
    if (!episode) return reply.code(404).send({ error: 'not_found' });
    const updated = await app.prisma.episode.update({
      where: { id: episode.id },
      data: {
        replacementR2Key: null,
        replacementDurationSeconds: null,
        replacementStatus: null,
        replacementUploadError: null,
        replacementTempVideoPath: null,
      },
    });
    await recordAdminAuditLog(app.prisma, {
      adminId: request.currentAdmin!.id,
      action: 'episode.replacement_abandon',
      targetType: 'episode',
      targetId: episode.id,
      seriesId: episode.seriesId,
      metadata: { episodeNumber: episode.episodeNumber },
    });
    return updated;
  }
);
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter api test -- episodes-upload.test.ts episodes.test.ts upload-queue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/episodes.ts apps/api/test/episodes-upload.test.ts apps/api/test/episodes.test.ts
git commit -m "feat(api): add replacement video operations"
```

---

### Task 8: Admin Workbench Data API and Recent Logs

**Files:**
- Modify: `apps/api/src/routes/series.ts`
- Modify: `apps/api/test/series.test.ts`

- [ ] **Step 1: Add failing tests**

In `apps/api/test/series.test.ts`, add:

```ts
it('returns an admin series detail with recent audit logs', async () => {
  const app = buildApp({ prisma });
  const token = await adminToken(app);
  const admin = await prisma.admin.findUniqueOrThrow({ where: { username: 'boss' } });
  const series = await prisma.series.create({ data: { title: 'Workbench' } });
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: 'series.publish',
      targetType: 'series',
      targetId: series.id,
      seriesId: series.id,
      metadata: { example: true },
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: `/api/admin/series/${series.id}`,
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().series.title).toBe('Workbench');
  expect(res.json().recentLogs).toHaveLength(1);
  expect(res.json().recentLogs[0].action).toBe('series.publish');
  await app.close();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter api test -- series.test.ts
```

Expected: FAIL because admin series detail route does not exist.

- [ ] **Step 3: Implement admin detail route**

In `apps/api/src/routes/series.ts`, add:

```ts
app.get<{ Params: { id: string } }>(
  '/api/admin/series/:id',
  { preHandler: requireAdmin },
  async (request, reply) => {
    const series = await app.prisma.series.findUnique({ where: { id: request.params.id } });
    if (!series) return reply.code(404).send({ error: 'not_found' });
    const recentLogs = await app.prisma.adminAuditLog.findMany({
      where: { seriesId: series.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { admin: { select: { username: true } } },
    });
    return { series, recentLogs };
  }
);
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter api test -- series.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/series.ts apps/api/test/series.test.ts
git commit -m "feat(api): expose admin series workbench data"
```

---

### Task 9: Admin Series List Search, Filters, and Sorting UI

**Files:**
- Modify: `apps/web/app/admin/page.tsx`
- Modify: `apps/web/test/admin-series-actions.test.mjs`

- [ ] **Step 1: Add failing frontend string tests**

Update `apps/web/test/admin-series-actions.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPage = readFileSync(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');

test('admin series rows expose a visible workbench action', () => {
  assert.match(adminPage, /href=\{`\/admin\/series\/\$\{s\.id\}`\}/);
  assert.match(adminPage, />\s*运营工作台\s*</);
});

test('admin list includes search and status filters', () => {
  assert.match(adminPage, /placeholder="搜索剧名"/);
  assert.match(adminPage, /value=\{statusFilter\}/);
  assert.match(adminPage, /value=\{updateStatusFilter\}/);
});

test('admin list displays free and update status labels', () => {
  assert.match(adminPage, /s\.unlockPriceCents === 0/);
  assert.match(adminPage, /UPDATE_STATUS_LABEL/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test apps/web/test/admin-series-actions.test.mjs
```

Expected: FAIL because the current page still says `管理集数` and lacks filter controls.

- [ ] **Step 3: Update admin page types and filters**

In `apps/web/app/admin/page.tsx`, expand `Series`:

```ts
interface Series {
  id: string;
  title: string;
  status: string;
  updateStatus: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
  sortOrder: number;
  lastPublishedEpisodeAt: string | null;
}

const UPDATE_STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
  paused: '暂停更新',
};
```

Add state:

```ts
const [query, setQuery] = useState('');
const [statusFilter, setStatusFilter] = useState('all');
const [updateStatusFilter, setUpdateStatusFilter] = useState('all');
```

Update `loadSeries`:

```ts
async function loadSeries() {
  try {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (updateStatusFilter !== 'all') params.set('updateStatus', updateStatusFilter);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE_URL}/api/admin/series${suffix}`, { headers: authHeaders() });
    if (!res.ok) {
      setListError('剧集列表加载失败，请重新登录后再试');
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      setListError('剧集列表加载失败，请稍后重试');
      return;
    }
    setSeriesList(data);
    setListError('');
  } catch {
    setListError('剧集列表加载失败，请稍后重试');
  }
}
```

Render filters above the table:

```tsx
<div className="admin-actions" style={{ padding: '0 16px 16px' }}>
  <input placeholder="搜索剧名" value={query} onChange={(e) => setQuery(e.target.value)} />
  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
    <option value="all">全部状态</option>
    <option value="draft">草稿</option>
    <option value="published">已上架</option>
    <option value="offline">已下架</option>
  </select>
  <select value={updateStatusFilter} onChange={(e) => setUpdateStatusFilter(e.target.value)}>
    <option value="all">全部更新</option>
    <option value="ongoing">连载中</option>
    <option value="completed">已完结</option>
    <option value="paused">暂停更新</option>
  </select>
  <button className="admin-btn" onClick={loadSeries}>筛选</button>
</div>
```

Change row action text to `运营工作台`, and display free/update labels:

```tsx
<td>{UPDATE_STATUS_LABEL[s.updateStatus] ?? s.updateStatus}</td>
<td>{s.unlockPriceCents === 0 ? '免费观看' : `NT$${(s.unlockPriceCents / 100).toFixed(0)}`}</td>
<Link href={`/admin/series/${s.id}`} className="admin-btn">
  运营工作台
</Link>
```

- [ ] **Step 4: Run frontend test**

Run:

```bash
node --test apps/web/test/admin-series-actions.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/page.tsx apps/web/test/admin-series-actions.test.mjs
git commit -m "feat(web): add admin series filters and workbench entry"
```

---

### Task 10: Single-Series Operations Workbench UI

**Files:**
- Modify: `apps/web/app/admin/series/[id]/page.tsx`
- Modify: `apps/web/test/admin-series-actions.test.mjs`

- [ ] **Step 1: Add failing frontend tests**

Append to `apps/web/test/admin-series-actions.test.mjs`:

```js
const workbenchPage = readFileSync(new URL('../app/admin/series/[id]/page.tsx', import.meta.url), 'utf8');

test('series workbench includes publishing, replacement, and audit sections', () => {
  assert.match(workbenchPage, />\s*基础信息\s*</);
  assert.match(workbenchPage, />\s*发布检查\s*</);
  assert.match(workbenchPage, />\s*上传新集数\s*</);
  assert.match(workbenchPage, />\s*最近操作\s*</);
  assert.match(workbenchPage, /replacement\/upload/);
  assert.match(workbenchPage, /replacement\/confirm/);
});

test('series workbench suggests the next episode number', () => {
  assert.match(workbenchPage, /nextEpisodeNumber/);
  assert.match(workbenchPage, /Math\.max/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test apps/web/test/admin-series-actions.test.mjs
```

Expected: FAIL because the page is still focused on episode upload/list only.

- [ ] **Step 3: Expand workbench state and load function**

In `apps/web/app/admin/series/[id]/page.tsx`, add interfaces:

```ts
interface SeriesDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  status: string;
  updateStatus: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
}

interface PublishCheckItem {
  code: string;
  message: string;
}

interface AuditLog {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  admin?: { username: string };
}
```

Add state:

```ts
const [series, setSeries] = useState<SeriesDetail | null>(null);
const [publishChecks, setPublishChecks] = useState<{ blockers: PublishCheckItem[]; warnings: PublishCheckItem[] }>({
  blockers: [],
  warnings: [],
});
const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
```

Update `load` to fetch workbench data, episodes, and checks:

```ts
const load = useCallback(async () => {
  try {
    const [detailRes, episodesRes, checksRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/admin/series/${params.id}`, { headers: authJsonHeaders() }),
      fetch(`${API_BASE_URL}/api/admin/series/${params.id}/episodes`, { headers: authJsonHeaders() }),
      fetch(`${API_BASE_URL}/api/admin/series/${params.id}/publish-checks`, { headers: authJsonHeaders() }),
    ]);

    if (!detailRes.ok || !episodesRes.ok || !checksRes.ok) {
      setListError('工作台加载失败');
      return;
    }

    const detail = await detailRes.json();
    const episodeData = await episodesRes.json();
    const checks = await checksRes.json();

    setSeries(detail.series);
    setRecentLogs(detail.recentLogs ?? []);
    setEpisodes(Array.isArray(episodeData) ? episodeData : []);
    setPublishChecks(checks);
    setListError('');
  } catch {
    setListError('工作台加载失败');
  }
}, [params.id]);
```

Add next-number calculation:

```ts
const nextEpisodeNumber = useMemo(() => {
  if (episodes.length === 0) return 1;
  return Math.max(...episodes.map((episode) => episode.episodeNumber)) + 1;
}, [episodes]);
```

When upload succeeds, set the next number:

```ts
setEpisodeNumber(String(nextEpisodeNumber + 1));
```

- [ ] **Step 4: Add workbench actions**

Add functions:

```ts
async function publishSeries() {
  const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/publish`, {
    method: 'POST',
    headers: authJsonHeaders(),
  });
  if (!res.ok) {
    setActionError(await responseError(res, '上架剧集失败'));
    return;
  }
  await load();
}

async function offlineSeries() {
  if (!confirm('确定下架整部剧？前台将不再显示。')) return;
  const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/offline`, {
    method: 'POST',
    headers: authJsonHeaders(),
  });
  if (!res.ok) {
    setActionError(await responseError(res, '下架剧集失败'));
    return;
  }
  await load();
}

async function offlineEpisode(id: string) {
  if (!confirm('确定下架这一集？前台将不再显示。')) return;
  const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/offline`, {
    method: 'POST',
    headers: authJsonHeaders(),
  });
  if (!res.ok) {
    setActionError(await responseError(res, '下架失败'));
    return;
  }
  await load();
}

async function uploadReplacement(id: string, file: File) {
  const form = new FormData();
  form.append('video', file);
  const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/upload`, {
    method: 'POST',
    headers: authOnlyHeaders(),
    body: form,
  });
  if (!res.ok) {
    setActionError(await responseError(res, '替换上传失败'));
    return;
  }
  await load();
}

async function confirmReplacement(id: string) {
  if (!confirm('确认用新视频替换当前线上视频？')) return;
  const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/confirm`, {
    method: 'POST',
    headers: authOnlyHeaders(),
  });
  if (!res.ok) {
    setActionError(await responseError(res, '确认替换失败'));
    return;
  }
  await load();
}
```

- [ ] **Step 5: Render workbench sections**

Add sections before the existing upload/list panels:

```tsx
<article className="panel">
  <div className="panel-head">
    <div>
      <h2>基础信息</h2>
      <p>{series ? `${series.status} / ${series.updateStatus}` : '加载中'}</p>
    </div>
    <div className="admin-actions">
      {series?.status === 'published' && (
        <Link href={`/series/${series.id}`} className="admin-btn">查看前台</Link>
      )}
      <button className="admin-btn admin-primary" onClick={publishSeries}>上架剧集</button>
      {series?.status === 'published' && <button className="admin-btn" onClick={offlineSeries}>下架剧集</button>}
    </div>
  </div>
  <div style={{ padding: 16 }}>
    <strong>{series?.title}</strong>
    {series?.unlockPriceCents === 0 ? <p>免费观看</p> : <p>试看 {series?.freeEpisodeCount} 集</p>}
  </div>
</article>

<article className="panel">
  <div className="panel-head">
    <div>
      <h2>发布检查</h2>
      <p>硬问题会阻止上架，提醒项可确认后继续。</p>
    </div>
  </div>
  <div style={{ padding: 16 }}>
    {publishChecks.blockers.map((item) => <p className="error-text" key={item.code}>{item.message}</p>)}
    {publishChecks.warnings.map((item) => <p className="view-status" key={item.code}>{item.message}</p>)}
    {publishChecks.blockers.length === 0 && publishChecks.warnings.length === 0 && <p>检查通过</p>}
  </div>
</article>
```

Add replacement controls in each episode row:

```tsx
{ep.status === 'published' && (
  <>
    <button className="admin-btn" onClick={() => offlineEpisode(ep.id)}>下架</button>
    <input
      type="file"
      accept="video/*"
      onChange={(e) => {
        const selected = e.target.files?.[0];
        if (selected) void uploadReplacement(ep.id, selected);
      }}
    />
  </>
)}
{ep.replacementStatus === 'ready' && (
  <button className="admin-btn admin-primary" onClick={() => confirmReplacement(ep.id)}>确认替换</button>
)}
```

Render recent logs:

```tsx
<article className="panel">
  <div className="panel-head">
    <div>
      <h2>最近操作</h2>
      <p>记录影响前台展示、收费或观看的关键动作。</p>
    </div>
  </div>
  <ul style={{ padding: 16 }}>
    {recentLogs.map((log) => (
      <li key={log.id}>{log.action} - {new Date(log.createdAt).toLocaleString()}</li>
    ))}
  </ul>
</article>
```

- [ ] **Step 6: Run frontend test**

Run:

```bash
node --test apps/web/test/admin-series-actions.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/series/[id]/page.tsx apps/web/test/admin-series-actions.test.mjs
git commit -m "feat(web): upgrade series page to operations workbench"
```

---

### Task 11: Public Free/Paid and Update-Status Display

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/series/[id]/page.tsx`
- Test: `apps/web/test/public-series-display.test.mjs`

- [ ] **Step 1: Add failing frontend tests**

Create `apps/web/test/public-series-display.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiClient = readFileSync(new URL('../lib/api-client.ts', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/series/[id]/page.tsx', import.meta.url), 'utf8');

test('api client exposes update status and latest publishing fields', () => {
  assert.match(apiClient, /updateStatus: string/);
  assert.match(apiClient, /lastPublishedEpisodeAt: string \| null/);
});

test('homepage shows free series and update status labels', () => {
  assert.match(homePage, /免费观看/);
  assert.match(homePage, /UPDATE_STATUS_LABEL/);
  assert.match(homePage, /series\.unlockPriceCents === 0/);
});

test('detail page does not lock episodes for free series', () => {
  assert.match(detailPage, /const isFreeSeries = series\?\.unlockPriceCents === 0/);
  assert.match(detailPage, /!isFreeSeries && episode\.episodeNumber > freeEpisodeCount/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test apps/web/test/public-series-display.test.mjs
```

Expected: FAIL because public UI does not yet use these fields.

- [ ] **Step 3: Update API client types**

In `apps/web/lib/api-client.ts`, extend `Series`:

```ts
export interface Series {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  freeEpisodeCount: number;
  unlockPriceCents: number;
  updateStatus: string;
  sortOrder: number;
  lastPublishedEpisodeAt: string | null;
}
```

- [ ] **Step 4: Update homepage labels**

In `apps/web/app/page.tsx`, add:

```ts
const UPDATE_STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
  paused: '暂停更新',
};
```

Replace the tag and meta text:

```tsx
<span className="tag">
  {series.unlockPriceCents === 0 ? '免费观看' : `前 ${series.freeEpisodeCount} 集免费`}
</span>
```

```tsx
<div className="video-meta">
  {UPDATE_STATUS_LABEL[series.updateStatus] ?? '连载中'} ·{' '}
  {series.unlockPriceCents === 0 ? '免费观看' : `解锁全集 ${formatPriceCents(series.unlockPriceCents)}`}
</div>
```

- [ ] **Step 5: Update detail page lock logic**

In `apps/web/app/series/[id]/page.tsx`, add:

```ts
const isFreeSeries = series?.unlockPriceCents === 0;
```

Change episode button class and label:

```tsx
className={`episode-btn ${episode.id === activeEpisodeId ? 'is-active' : ''} ${
  !isFreeSeries && episode.episodeNumber > freeEpisodeCount ? 'is-locked' : ''
}`}
```

```tsx
{!isFreeSeries && episode.episodeNumber > freeEpisodeCount ? '锁' : episode.episodeNumber}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test apps/web/test/public-series-display.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/app/page.tsx apps/web/app/series/[id]/page.tsx apps/web/test/public-series-display.test.mjs
git commit -m "feat(web): show free series and update status publicly"
```

---

### Task 12: Full Verification and Cleanup

**Files:**
- Verify all touched files
- Revert generated `apps/web/tsconfig.json` changes if Next.js modified it during manual dev server checks

- [ ] **Step 1: Run backend tests**

Run:

```bash
pnpm --filter api test
```

Expected: PASS for all API tests.

- [ ] **Step 2: Run backend typecheck**

Run:

```bash
pnpm --filter api exec tsc -p tsconfig.json --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run frontend static tests**

Run:

```bash
node --test apps/web/test/*.test.mjs
```

Expected: PASS for all frontend static tests.

- [ ] **Step 4: Optional manual smoke test**

Start services:

```bash
pnpm dev:api
pnpm --filter web dev -- -p 3002
```

Manual expected behavior:

- `/admin` filters series by search/status/update status.
- `/admin/series/:id` shows基础信息、发布检查、上传新集数、最近操作.
- Uploading a new episode creates `processing`, then `draft` after queue completion.
- Publishing a draft episode makes it visible on public detail and updates homepage ordering.
- A series with `unlockPriceCents = 0` lets anonymous users play any published episode.
- Replacing a published episode does not change public playback until confirmation.

- [ ] **Step 5: Check diff for unrelated changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files related to content operations publishing are modified. If `apps/web/tsconfig.json` only contains Next.js generated include/plugin churn, revert that file before committing:

```bash
git checkout -- apps/web/tsconfig.json
```

- [ ] **Step 6: Commit verification fixes if any**

If verification required small fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize content operations publishing"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Single-series operations workbench: Tasks 8 and 10.
  - New episode continuation flow: Tasks 5 and 10.
  - Publish checks: Task 4 and Task 10.
  - Free-series access: Task 3 and Task 11.
  - Offline states: Tasks 1, 4, 5.
  - Replacement video flow: Tasks 6, 7, 10.
  - Homepage ordering and recent update tracking: Tasks 3, 5, 9, 11.
  - Audit logs: Tasks 2, 4, 5, 7, 8, 10.
  - Admin search/filter: Tasks 4 and 9.
- No scheduled publishing, batch upload, asset library, tags, draft preview, or banner system is included.
- Replacement upload never overwrites `Episode.r2Key` until confirm.
- `offline` is treated separately from `draft`.
- Backend changes are test-first.
