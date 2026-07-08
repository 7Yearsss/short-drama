import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanDb } from './helpers/clean-db.js';

const mocks = vi.hoisted(() => ({
  probeDuration: vi.fn(),
  rm: vi.fn(),
  transcodeVideo: vi.fn(),
  uploadEpisodeVideo: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rm: mocks.rm,
}));

vi.mock('../src/lib/transcode.js', () => ({
  probeDuration: mocks.probeDuration,
  transcodeVideo: mocks.transcodeVideo,
}));

vi.mock('../src/lib/r2.js', () => ({
  uploadEpisodeVideo: mocks.uploadEpisodeVideo,
}));

import { enqueueEpisodeUpload, recoverOrphanedUploads, waitForQueueIdle } from '../src/lib/upload-queue.js';

const prisma = new PrismaClient();

describe('upload queue', () => {
  beforeEach(async () => {
    await waitForQueueIdle();
    await cleanDb(prisma);
    vi.clearAllMocks();
    mocks.transcodeVideo.mockResolvedValue(undefined);
    mocks.probeDuration.mockResolvedValue(120);
    mocks.uploadEpisodeVideo.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await waitForQueueIdle();
    await prisma.$disconnect();
  });

  it('transcodes, uploads, and marks an episode as draft', async () => {
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'processing',
        uploadError: 'previous error',
        tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      },
    });

    enqueueEpisodeUpload(prisma, {
      episodeId: episode.id,
      tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      seriesId: series.id,
      episodeNumber: 1,
    });
    await waitForQueueIdle();

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    const outputPath = 'C:\\tmp\\episode-1.mp4-encoded.mp4';

    expect(mocks.transcodeVideo).toHaveBeenCalledWith('C:\\tmp\\episode-1.mp4', outputPath);
    expect(mocks.probeDuration).toHaveBeenCalledWith(outputPath);
    expect(mocks.uploadEpisodeVideo).toHaveBeenCalledWith(`series/${series.id}/episode-1.mp4`, outputPath);
    expect(updated.status).toBe('draft');
    expect(updated.r2Key).toBe(`series/${series.id}/episode-1.mp4`);
    expect(updated.durationSeconds).toBe(120);
    expect(updated.uploadError).toBeNull();
    expect(updated.tempVideoPath).toBeNull();
  });

  it('keeps the episode successful when best-effort cleanup fails after upload', async () => {
    mocks.rm.mockRejectedValue(new Error('cleanup failed'));
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'processing',
        tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      },
    });

    enqueueEpisodeUpload(prisma, {
      episodeId: episode.id,
      tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      seriesId: series.id,
      episodeNumber: 1,
    });
    await waitForQueueIdle();

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(updated.status).toBe('draft');
    expect(updated.r2Key).toBe(`series/${series.id}/episode-1.mp4`);
    expect(updated.durationSeconds).toBe(120);
    expect(updated.tempVideoPath).toBeNull();
    expect(updated.uploadError).toBeNull();
  });

  it('processes multiple enqueued jobs sequentially and updates every episode', async () => {
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode1 = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'processing',
        tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      },
    });
    const episode2 = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 2,
        title: 'Episode 2',
        status: 'processing',
        tempVideoPath: 'C:\\tmp\\episode-2.mp4',
      },
    });

    mocks.probeDuration.mockImplementation(async (filePath: string) => (filePath.includes('episode-2') ? 180 : 120));

    enqueueEpisodeUpload(prisma, {
      episodeId: episode1.id,
      tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      seriesId: series.id,
      episodeNumber: 1,
    });
    enqueueEpisodeUpload(prisma, {
      episodeId: episode2.id,
      tempVideoPath: 'C:\\tmp\\episode-2.mp4',
      seriesId: series.id,
      episodeNumber: 2,
    });
    await waitForQueueIdle();

    const episodes = await prisma.episode.findMany({ orderBy: { episodeNumber: 'asc' } });
    expect(episodes.map((episode) => ({
      status: episode.status,
      r2Key: episode.r2Key,
      durationSeconds: episode.durationSeconds,
      tempVideoPath: episode.tempVideoPath,
      uploadError: episode.uploadError,
    }))).toEqual([
      {
        status: 'draft',
        r2Key: `series/${series.id}/episode-1.mp4`,
        durationSeconds: 120,
        tempVideoPath: null,
        uploadError: null,
      },
      {
        status: 'draft',
        r2Key: `series/${series.id}/episode-2.mp4`,
        durationSeconds: 180,
        tempVideoPath: null,
        uploadError: null,
      },
    ]);
    expect(mocks.uploadEpisodeVideo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transcodeVideo.mock.invocationCallOrder[1],
    );
  });

  it('marks an episode as failed and retains tempVideoPath when transcode fails', async () => {
    mocks.transcodeVideo.mockRejectedValue(new Error('ffmpeg exited 1'));
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'processing',
        tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      },
    });

    enqueueEpisodeUpload(prisma, {
      episodeId: episode.id,
      tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      seriesId: series.id,
      episodeNumber: 1,
    });
    await waitForQueueIdle();

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });

    expect(updated.status).toBe('failed');
    expect(updated.uploadError).toContain('ffmpeg exited 1');
    expect(updated.tempVideoPath).toBe('C:\\tmp\\episode-1.mp4');
    expect(mocks.uploadEpisodeVideo).not.toHaveBeenCalled();
  });

  it('stores replacement video output without changing the published r2Key', async () => {
    mocks.probeDuration.mockResolvedValue(88);
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

  it('marks processing episodes as failed during orphan recovery', async () => {
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    const episode = await prisma.episode.create({
      data: {
        seriesId: series.id,
        episodeNumber: 1,
        title: 'Episode 1',
        status: 'processing',
        tempVideoPath: 'C:\\tmp\\episode-1.mp4',
      },
    });

    await recoverOrphanedUploads(prisma);

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(updated.status).toBe('failed');
    expect(updated.uploadError).toBe('服务重启导致任务中断，请重试');
  });

  it('leaves non-processing episodes untouched during orphan recovery', async () => {
    const series = await prisma.series.create({ data: { title: 'Test Series' } });
    await prisma.episode.createMany({
      data: [
        { seriesId: series.id, episodeNumber: 1, title: 'Draft', status: 'draft', uploadError: null },
        { seriesId: series.id, episodeNumber: 2, title: 'Published', status: 'published', uploadError: null },
        { seriesId: series.id, episodeNumber: 3, title: 'Failed', status: 'failed', uploadError: 'old error' },
      ],
    });

    await recoverOrphanedUploads(prisma);

    const episodes = await prisma.episode.findMany({ orderBy: { episodeNumber: 'asc' } });
    expect(episodes.map((episode) => ({ status: episode.status, uploadError: episode.uploadError }))).toEqual([
      { status: 'draft', uploadError: null },
      { status: 'published', uploadError: null },
      { status: 'failed', uploadError: 'old error' },
    ]);
  });
});
