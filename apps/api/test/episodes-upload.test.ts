import { readdir, rm } from 'node:fs/promises';
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

async function videoUploadPayload(
  fields: Record<string, string>,
  contentType = 'video/mp4',
  options: { fieldName?: string; fileFirst?: boolean; includeFile?: boolean } = {}
) {
  return multipartPayload({
    fields,
    file:
      options.includeFile === false
        ? undefined
        : {
            fieldName: options.fieldName ?? 'video',
            filename: contentType.startsWith('video/') ? 'episode.mp4' : 'notes.txt',
            contentType,
            content: Buffer.from('fake video bytes'),
          },
    fileFirst: options.fileFirst,
  });
}

async function uploadDirEntries() {
  return readdir(UPLOAD_DIR).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
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

  it('accepts the video file before the text fields', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const multipart = await videoUploadPayload(
      {
        seriesId: series.id,
        episodeNumber: '1',
        title: 'Episode 1',
      },
      'video/mp4',
      { fileFirst: true }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      seriesId: series.id,
      episodeNumber: 1,
      title: 'Episode 1',
      status: 'processing',
    });
    expect(enqueueEpisodeUpload).toHaveBeenCalledTimes(1);
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

  it('returns 400 when the uploaded file field is not video', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const multipart = await videoUploadPayload(
      {
        seriesId: series.id,
        episodeNumber: '1',
        title: 'Episode 1',
      },
      'video/mp4',
      { fieldName: 'poster' }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'missing_video' });
    expect(await prisma.episode.count()).toBe(0);
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is uploaded', async () => {
    const token = await adminToken(app);
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const multipart = await videoUploadPayload(
      {
        seriesId: series.id,
        episodeNumber: '1',
        title: 'Episode 1',
      },
      'video/mp4',
      { includeFile: false }
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/episodes/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'missing_video' });
    expect(await prisma.episode.count()).toBe(0);
    expect(enqueueEpisodeUpload).not.toHaveBeenCalled();
  });

  it('cleans up the temp file and marks the episode failed when enqueue throws', async () => {
    vi.mocked(enqueueEpisodeUpload).mockImplementationOnce(() => {
      throw new Error('queue unavailable');
    });
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

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(await uploadDirEntries()).toEqual([]);
    const episode = await prisma.episode.findFirstOrThrow();
    expect(episode.status).toBe('failed');
    expect(episode.tempVideoPath).toBeNull();
    expect(episode.uploadError).toContain('queue unavailable');
  });

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
    expect(enqueueEpisodeUpload).toHaveBeenCalledTimes(1);
    const [queuedPrisma, job] = vi.mocked(enqueueEpisodeUpload).mock.calls[0];
    expect(queuedPrisma).toBe(prisma);
    expect(job).toEqual(
      expect.objectContaining({ kind: 'replacement', episodeId: episode.id, seriesId: series.id, episodeNumber: 8 })
    );
    const logs = await prisma.adminAuditLog.findMany();
    expect(logs.map((log) => log.action)).toEqual(['episode.replacement_start']);
  });
});
