import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

interface SeriesBody {
  title: string;
  description?: string;
  coverUrl?: string;
  freeEpisodeCount?: number;
  unlockPriceCents?: number;
  status?: string;
}

export async function seriesRoutes(app: FastifyInstance) {
  app.post<{ Body: SeriesBody }>('/api/admin/series', { preHandler: requireAdmin }, async (request) => {
    const { title, description, coverUrl, freeEpisodeCount, unlockPriceCents } = request.body;
    return app.prisma.series.create({
      data: {
        title,
        description,
        coverUrl,
        freeEpisodeCount: freeEpisodeCount ?? 2,
        unlockPriceCents: unlockPriceCents ?? 9900,
      },
    });
  });

  app.get('/api/admin/series', { preHandler: requireAdmin }, async () => {
    return app.prisma.series.findMany({ orderBy: { createdAt: 'desc' } });
  });

  app.patch<{ Params: { id: string }; Body: SeriesBody }>(
    '/api/admin/series/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await app.prisma.series.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      return app.prisma.series.update({ where: { id: request.params.id }, data: request.body });
    }
  );

  app.get('/api/series', async () => {
    return app.prisma.series.findMany({ where: { status: 'published' }, orderBy: { createdAt: 'desc' } });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id', async (request, reply) => {
    const series = await app.prisma.series.findFirst({ where: { id: request.params.id, status: 'published' } });
    if (!series) return reply.code(404).send({ error: 'not_found' });
    return series;
  });
}
