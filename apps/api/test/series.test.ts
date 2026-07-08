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
});
