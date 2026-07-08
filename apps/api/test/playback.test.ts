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
    await app.ready();
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

  it('returns 404 for a published episode without an uploaded video key', async () => {
    const series = await prisma.series.create({ data: { title: 'Test', status: 'published' } });
    const episode = await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Ep 1', status: 'published', r2Key: null },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'GET', url: `/api/episodes/${episode.id}/playback` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
