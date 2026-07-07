import { rm } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { uploadEpisodeVideo } from './r2.js';
import { probeDuration, transcodeVideo } from './transcode.js';

export interface UploadJob {
  episodeId: string;
  tempVideoPath: string;
  seriesId: string;
  episodeNumber: number;
}

const queue: UploadJob[] = [];
let drainPromise: Promise<void> | undefined;

export function enqueueEpisodeUpload(prisma: PrismaClient, job: UploadJob): void {
  queue.push(job);
  if (!drainPromise) {
    drainPromise = drainQueue(prisma).finally(() => {
      drainPromise = undefined;
    });
  }
}

export async function waitForQueueIdle(): Promise<void> {
  await drainPromise;
}

export async function recoverOrphanedUploads(prisma: PrismaClient): Promise<void> {
  await prisma.episode.updateMany({
    where: { status: 'processing' },
    data: { status: 'failed', uploadError: '服务重启导致任务中断，请重试' },
  });
}

async function drainQueue(prisma: PrismaClient): Promise<void> {
  for (;;) {
    const job = queue.shift();
    if (!job) {
      return;
    }
    await runJob(prisma, job);
  }
}

async function runJob(prisma: PrismaClient, job: UploadJob): Promise<void> {
  const outputPath = `${job.tempVideoPath}-encoded.mp4`;
  try {
    await transcodeVideo(job.tempVideoPath, outputPath);
    const durationSeconds = await probeDuration(outputPath);
    const r2Key = `series/${job.seriesId}/episode-${job.episodeNumber}.mp4`;
    await uploadEpisodeVideo(r2Key, outputPath);
    await rm(job.tempVideoPath, { force: true });
    await rm(outputPath, { force: true });
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
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    await prisma.episode.update({
      where: { id: job.episodeId },
      data: {
        status: 'failed',
        uploadError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
