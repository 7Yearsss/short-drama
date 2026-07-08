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

  it('does not list offline series on the public endpoint', async () => {
    await prisma.series.create({ data: { title: 'Hidden', status: 'offline' } });
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: '/api/series' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('orders public series by sortOrder, lastPublishedEpisodeAt, then createdAt', async () => {
    const oldest = new Date('2026-01-01T00:00:00.000Z');
    const older = new Date('2026-01-02T00:00:00.000Z');
    const newer = new Date('2026-01-03T00:00:00.000Z');
    const newest = new Date('2026-01-04T00:00:00.000Z');
    await prisma.series.create({
      data: { title: 'Sort order wins', status: 'published', sortOrder: 10, lastPublishedEpisodeAt: oldest },
    });
    await prisma.series.create({
      data: { title: 'Newer published wins', status: 'published', sortOrder: 5, lastPublishedEpisodeAt: newest },
    });
    await prisma.series.create({
      data: { title: 'Older published loses', status: 'published', sortOrder: 5, lastPublishedEpisodeAt: newer },
    });
    await prisma.series.create({
      data: { title: 'Never updated sorts last', status: 'published', sortOrder: 5, lastPublishedEpisodeAt: null },
    });
    await prisma.series.create({
      data: {
        title: 'Newer created wins',
        status: 'published',
        sortOrder: 0,
        lastPublishedEpisodeAt: older,
        createdAt: newest,
      },
    });
    await prisma.series.create({
      data: {
        title: 'Older created loses',
        status: 'published',
        sortOrder: 0,
        lastPublishedEpisodeAt: older,
        createdAt: oldest,
      },
    });

    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: '/api/series' });

    expect(res.json().map((series: { title: string }) => series.title)).toEqual([
      'Sort order wins',
      'Newer published wins',
      'Older published loses',
      'Never updated sorts last',
      'Newer created wins',
      'Older created loses',
    ]);
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

  it('returns publish checks with blockers and warnings', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const series = await prisma.series.create({
      data: { title: 'No Cover', description: null, coverUrl: null, freeEpisodeCount: 5 },
    });
    await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'failed', uploadError: 'bad file' },
    });
    await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 2, title: 'Ep 2', status: 'draft' },
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

  it('returns missing episodes blocker when a series only has failed episodes', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const series = await prisma.series.create({
      data: { title: 'Failed Only', coverUrl: 'https://img.example/cover.jpg' },
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
    expect(res.json().blockers).toEqual(
      expect.arrayContaining([{ code: 'missing_episodes', message: '请先上传至少一集' }])
    );
    expect(res.json().warnings).toEqual(
      expect.arrayContaining([{ code: 'has_failed_episodes', message: '存在转码失败的集数' }])
    );
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

  it('rolls back publishing when audit logging fails', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    await prisma.admin.deleteMany();
    const series = await prisma.series.create({ data: { title: 'Ready', coverUrl: 'https://img.example/cover.jpg' } });
    await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'draft', r2Key: 'x.mp4' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/series/${series.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(500);
    const unchanged = await prisma.series.findUniqueOrThrow({ where: { id: series.id } });
    expect(unchanged.status).toBe('draft');
    expect(unchanged.publishedAt).toBeNull();
    expect(await prisma.adminAuditLog.count()).toBe(0);
    await app.close();
  });

  it('rolls back offlining when audit logging fails', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    await prisma.admin.deleteMany();
    const series = await prisma.series.create({
      data: { title: 'Live', status: 'published', coverUrl: 'https://img.example/cover.jpg', publishedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/series/${series.id}/offline`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(500);
    const unchanged = await prisma.series.findUniqueOrThrow({ where: { id: series.id } });
    expect(unchanged.status).toBe('published');
    expect(unchanged.offlineAt).toBeNull();
    expect(await prisma.adminAuditLog.count()).toBe(0);
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

  it('treats all admin status filters as unfiltered', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    await prisma.series.create({ data: { title: 'Draft Show', status: 'draft', updateStatus: 'ongoing' } });
    await prisma.series.create({ data: { title: 'Offline Show', status: 'offline', updateStatus: 'completed' } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/series?status=all&updateStatus=all',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((series: { title: string }) => series.title).sort()).toEqual(['Draft Show', 'Offline Show']);
    await app.close();
  });
});
