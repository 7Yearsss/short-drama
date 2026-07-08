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

  it('rejects publishing an episode before a video key exists', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const episode = await prisma.episode.create({
      data: { seriesId, episodeNumber: 1, title: '第1集', status: 'draft' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/episodes/${episode.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'published' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'video_not_uploaded' });
    await app.close();
  });

  it('public episode listing excludes published episodes without a video key', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    await prisma.episode.create({
      data: { seriesId, episodeNumber: 1, title: '第1集', status: 'published' },
    });

    const res = await app.inject({ method: 'GET', url: `/api/series/${seriesId}/episodes` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
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
