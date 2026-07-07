import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { enqueueEpisodeUpload } from '../src/lib/upload-queue.js';
import { cleanDb } from './helpers/clean-db.js';

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

async function createSeries(app: ReturnType<typeof buildApp>, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/series',
    headers: { authorization: `Bearer ${token}` },
    payload: { title: 'Retry Test Series' },
  });
  return res.json().id as string;
}

describe('POST /api/admin/episodes/:id/retry', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await cleanDb(prisma);
    vi.mocked(enqueueEpisodeUpload).mockReset();
    app = buildApp({ prisma });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retries a failed episode using the retained temp file', async () => {
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const episode = await prisma.episode.create({
      data: {
        seriesId,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'failed',
        tempVideoPath: 'tmp/uploads/retry-source.mp4',
        uploadError: 'ffmpeg exited 1',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: episode.id,
      status: 'processing',
      uploadError: null,
      tempVideoPath: episode.tempVideoPath,
    });

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(updated.status).toBe('processing');
    expect(updated.uploadError).toBeNull();
    expect(updated.tempVideoPath).toBe(episode.tempVideoPath);
    expect(enqueueEpisodeUpload).toHaveBeenCalledTimes(1);
    const [queuedPrisma, job] = vi.mocked(enqueueEpisodeUpload).mock.calls[0];
    expect(queuedPrisma).toBe(prisma);
    expect(job).toEqual({
      episodeId: episode.id,
      tempVideoPath: episode.tempVideoPath,
      seriesId,
      episodeNumber: 1,
    });
  });

  it('rejects retry when episode is not failed', async () => {
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const episode = await prisma.episode.create({
      data: {
        seriesId,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'draft',
        tempVideoPath: 'tmp/uploads/retry-source.mp4',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_failed' });
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown episode', async () => {
    const token = await adminToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/does-not-exist/retry',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('rejects a failed episode with no retained temp file', async () => {
    const token = await adminToken(app);
    const seriesId = await createSeries(app, token);
    const episode = await prisma.episode.create({
      data: {
        seriesId,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'failed',
        uploadError: 'file was already discarded',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/episodes/${episode.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'no_retained_file' });
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });
});
