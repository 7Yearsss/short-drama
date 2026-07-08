import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { FastifyInstance } from 'fastify';
import { Prisma, type Episode } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin.js';
import { enqueueEpisodeUpload } from '../lib/upload-queue.js';

interface CreateEpisodeBody {
  seriesId: string;
  episodeNumber: number;
  title: string;
  r2Key: string;
  durationSeconds?: number;
}

interface UpdateEpisodeBody {
  title?: string;
  status?: string;
  durationSeconds?: number;
}

export const UPLOAD_DIR = path.join(process.cwd(), 'tmp', 'uploads');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function discardStream(stream: NodeJS.ReadableStream): Promise<void> {
  await pipeline(
    stream,
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    })
  );
}

export async function episodeRoutes(app: FastifyInstance) {
  app.post('/api/admin/episodes/upload', { preHandler: requireAdmin }, async (request, reply) => {
    const fields: Record<string, string | undefined> = {};
    let tempVideoPath: string | undefined;
    let sawAnyFile = false;
    let sawWrongFileField = false;
    let sawInvalidVideo = false;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
          continue;
        }

        sawAnyFile = true;

        if (part.fieldname !== 'video') {
          sawWrongFileField = true;
          await discardStream(part.file);
          continue;
        }

        if (!part.mimetype.startsWith('video/')) {
          sawInvalidVideo = true;
          await discardStream(part.file);
          continue;
        }

        if (tempVideoPath) {
          sawWrongFileField = true;
          await discardStream(part.file);
          continue;
        }

        await mkdir(UPLOAD_DIR, { recursive: true });
        tempVideoPath = path.join(UPLOAD_DIR, `${randomUUID()}.mp4`);
        await pipeline(part.file, createWriteStream(tempVideoPath));
      }

      if (sawInvalidVideo) {
        if (tempVideoPath) await rm(tempVideoPath, { force: true });
        return reply.code(400).send({ error: 'invalid_video' });
      }

      if (!sawAnyFile || sawWrongFileField || !tempVideoPath) {
        if (tempVideoPath) await rm(tempVideoPath, { force: true });
        return reply.code(400).send({ error: 'missing_video' });
      }

      const seriesId = fields.seriesId;
      const episodeNumberValue = fields.episodeNumber;
      const title = fields.title;
      const episodeNumber = Number(episodeNumberValue);

      if (!seriesId || !episodeNumberValue || !title || !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
        await rm(tempVideoPath, { force: true });
        return reply.code(400).send({ error: 'missing_fields' });
      }

      const series = await app.prisma.series.findUnique({ where: { id: seriesId } });
      if (!series) {
        await rm(tempVideoPath, { force: true });
        return reply.code(404).send({ error: 'series_not_found' });
      }

      const existing = await app.prisma.episode.findUnique({
        where: { seriesId_episodeNumber: { seriesId, episodeNumber } },
      });
      if (existing) {
        await rm(tempVideoPath, { force: true });
        return reply.code(400).send({ error: 'episode_number_taken' });
      }

      let episode: Episode;
      try {
        episode = await app.prisma.episode.create({
          data: {
            seriesId,
            episodeNumber,
            title,
            status: 'processing',
            tempVideoPath,
          },
        });
      } catch (error) {
        await rm(tempVideoPath, { force: true });
        if (isUniqueConstraintError(error)) {
          return reply.code(400).send({ error: 'episode_number_taken' });
        }
        throw error;
      }

      try {
        enqueueEpisodeUpload(app.prisma, { episodeId: episode.id, tempVideoPath, seriesId, episodeNumber });
      } catch (error) {
        await rm(tempVideoPath, { force: true });
        await app.prisma.episode.update({
          where: { id: episode.id },
          data: {
            status: 'failed',
            tempVideoPath: null,
            uploadError: errorMessage(error),
          },
        });
        return reply.code(500).send({ error: 'upload_enqueue_failed' });
      }

      return episode;
    } catch (error) {
      if (tempVideoPath) {
        await rm(tempVideoPath, { force: true });
      }
      request.log.error(error);
      return reply.code(500).send({ error: 'upload_failed' });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/episodes/:id/retry',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
      if (!episode) return reply.code(404).send({ error: 'not_found' });
      if (episode.status !== 'failed') return reply.code(409).send({ error: 'not_failed' });
      if (!episode.tempVideoPath) return reply.code(409).send({ error: 'no_retained_file' });

      const transition = await app.prisma.episode.updateMany({
        where: { id: episode.id, status: 'failed', tempVideoPath: { not: null } },
        data: { status: 'processing', uploadError: null },
      });

      if (transition.count === 0) {
        const current = await app.prisma.episode.findUnique({ where: { id: episode.id } });
        if (!current) return reply.code(404).send({ error: 'not_found' });
        if (current.status === 'failed' && !current.tempVideoPath) return reply.code(409).send({ error: 'no_retained_file' });
        return reply.code(409).send({ error: 'not_failed' });
      }

      const updated = await app.prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });

      try {
        enqueueEpisodeUpload(app.prisma, {
          episodeId: episode.id,
          tempVideoPath: episode.tempVideoPath,
          seriesId: episode.seriesId,
          episodeNumber: episode.episodeNumber,
        });
      } catch (error) {
        await app.prisma.episode.update({
          where: { id: episode.id },
          data: {
            status: 'failed',
            uploadError: errorMessage(error),
          },
        });
        return reply.code(500).send({ error: 'upload_enqueue_failed' });
      }

      return updated;
    }
  );

  app.post<{ Body: CreateEpisodeBody }>(
    '/api/admin/episodes',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { seriesId, episodeNumber, title, r2Key, durationSeconds } = request.body;
      const series = await app.prisma.series.findUnique({ where: { id: seriesId } });
      if (!series) return reply.code(404).send({ error: 'series_not_found' });
      return app.prisma.episode.create({
        data: { seriesId, episodeNumber, title, r2Key, durationSeconds },
      });
    }
  );

  app.patch<{ Params: { id: string }; Body: UpdateEpisodeBody }>(
    '/api/admin/episodes/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      if (request.body.status === 'published' && !existing.r2Key) {
        return reply.code(409).send({ error: 'video_not_uploaded' });
      }
      return app.prisma.episode.update({ where: { id: request.params.id }, data: request.body });
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/series/:id/episodes', { preHandler: requireAdmin }, async (request) => {
    return app.prisma.episode.findMany({ where: { seriesId: request.params.id }, orderBy: { episodeNumber: 'asc' } });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id/episodes', async (request) => {
    return app.prisma.episode.findMany({
      where: { seriesId: request.params.id, status: 'published', r2Key: { not: null } },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, episodeNumber: true, title: true, durationSeconds: true },
    });
  });
}
