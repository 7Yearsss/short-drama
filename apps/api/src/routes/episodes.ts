import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { FastifyInstance } from 'fastify';
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

function multipartField(fields: Record<string, unknown>, key: string): string | undefined {
  const field = fields[key];
  if (!field || Array.isArray(field) || typeof field !== 'object' || !('value' in field)) {
    return undefined;
  }

  const value = (field as { value: unknown }).value;
  return typeof value === 'string' ? value : undefined;
}

export async function episodeRoutes(app: FastifyInstance) {
  app.post('/api/admin/episodes/upload', { preHandler: requireAdmin }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'missing_video' });
    }

    const fields = data.fields as Record<string, unknown>;
    const seriesId = multipartField(fields, 'seriesId');
    const episodeNumberValue = multipartField(fields, 'episodeNumber');
    const title = multipartField(fields, 'title');
    const episodeNumber = Number(episodeNumberValue);

    if (!seriesId || !episodeNumberValue || !title || !Number.isInteger(episodeNumber)) {
      return reply.code(400).send({ error: 'missing_fields' });
    }

    if (!data.mimetype.startsWith('video/')) {
      return reply.code(400).send({ error: 'invalid_video' });
    }

    const series = await app.prisma.series.findUnique({ where: { id: seriesId } });
    if (!series) {
      return reply.code(404).send({ error: 'series_not_found' });
    }

    const existing = await app.prisma.episode.findUnique({
      where: { seriesId_episodeNumber: { seriesId, episodeNumber } },
    });
    if (existing) {
      return reply.code(400).send({ error: 'episode_number_taken' });
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const tempVideoPath = path.join(UPLOAD_DIR, `${randomUUID()}.mp4`);
    await pipeline(data.file, createWriteStream(tempVideoPath));

    const episode = await app.prisma.episode.create({
      data: {
        seriesId,
        episodeNumber,
        title,
        status: 'processing',
        tempVideoPath,
      },
    });

    enqueueEpisodeUpload(app.prisma, { episodeId: episode.id, tempVideoPath, seriesId, episodeNumber });
    return episode;
  });

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
      return app.prisma.episode.update({ where: { id: request.params.id }, data: request.body });
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/series/:id/episodes', { preHandler: requireAdmin }, async (request) => {
    return app.prisma.episode.findMany({ where: { seriesId: request.params.id }, orderBy: { episodeNumber: 'asc' } });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id/episodes', async (request) => {
    return app.prisma.episode.findMany({
      where: { seriesId: request.params.id, status: 'published' },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, episodeNumber: true, title: true, durationSeconds: true },
    });
  });
}
