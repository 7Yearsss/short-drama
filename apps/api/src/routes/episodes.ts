import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

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

export async function episodeRoutes(app: FastifyInstance) {
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
