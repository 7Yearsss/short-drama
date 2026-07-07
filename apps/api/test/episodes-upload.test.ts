import { rm } from 'node:fs/promises';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { UPLOAD_DIR } from '../src/routes/episodes.js';
import { hashPassword } from '../src/lib/password.js';
import { cleanDb } from './helpers/clean-db.js';
import { multipartPayload } from './helpers/multipart.js';
import { enqueueEpisodeUpload } from '../src/lib/upload-queue.js';

vi.mock('../src/lib/upload-queue.js', () => ({
  enqueueEpisodeUpload: vi.fn(),
}));

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { username: 'boss', password: 'secret123' },
  });
  return res.json().token as string;
}

async function videoUploadPayload(fields: Record<string, string>, contentType = 'video/mp4') {
  return multipartPayload({
    fields,
    file: {
      fieldName: 'video',
      filename: contentType.startsWith('video/') ? 'episode.mp4' : 'notes.txt',
      contentType,
      content: Buffer.from('fake video bytes'),
    },
  });
}

describe('POST /api/admin/episodes/upload', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await cleanDb(prisma);
    vi.mocked(enqueueEpisodeUpload).mockReset();
    app = buildApp({ prisma });
  });

  afterEach(async () => {
    await app.close();
    await rm(UPLOAD_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(UPLOAD_DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('creates a processing episode and enqueues the uploaded video for an authenticated admin', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const multipart = await videoUploadPayload({
      seriesId: series.id,
      episodeNumber: '1',
      title: 'Episode 1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      seriesId: series.id,
      episodeNumber: 1,
      title: 'Episode 1',
      status: 'processing',
      r2Key: null,
    });
    expect(body.tempVideoPath).toEqual(expect.stringContaining(UPLOAD_DIR));

    const episode = await prisma.episode.findUniqueOrThrow({ where: { id: body.id } });
    expect(episode.r2Key).toBeNull();
    expect(episode.status).toBe('processing');
    expect(episode.tempVideoPath).toBe(body.tempVideoPath);
    expect(enqueueEpisodeUpload).toHaveBeenCalledTimes(1);
    const [queuedPrisma, job] = vi.mocked(enqueueEpisodeUpload).mock.calls[0];
    expect(queuedPrisma).toBe(prisma);
    expect(job).toEqual({
      episodeId: episode.id,
      tempVideoPath: episode.tempVideoPath,
      seriesId: series.id,
      episodeNumber: 1,
    });
  });

  it('returns 404 when the series does not exist', async () => {
    const token = await adminToken(app);
    const multipart = await videoUploadPayload({
      seriesId: 'does-not-exist',
      episodeNumber: '1',
      title: 'Episode 1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'series_not_found' });
    expect(await prisma.episode.count()).toBe(0);
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('returns 400 when the episode number is already taken', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    await prisma.episode.create({
      data: { seriesId: series.id, episodeNumber: 1, title: 'Existing Episode', r2Key: 'series/1/episode-1.mp4' },
    });
    const multipart = await videoUploadPayload({
      seriesId: series.id,
      episodeNumber: '1',
      title: 'Episode 1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'episode_number_taken' });
    expect(await prisma.episode.count()).toBe(1);
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-video file', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const multipart = await videoUploadPayload(
      {
        seriesId: series.id,
        episodeNumber: '1',
        title: 'Episode 1',
      },
      'text/plain'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_video' });
    expect(await prisma.episode.count()).toBe(0);
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });
});
