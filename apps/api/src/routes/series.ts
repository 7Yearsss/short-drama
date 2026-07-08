import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { evaluateSeriesPublishChecks } from '../lib/publish-checks.js';
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

  app.get<{ Querystring: { q?: string; status?: string; updateStatus?: string } }>(
    '/api/admin/series',
    { preHandler: requireAdmin },
    async (request) => {
      const where: Prisma.SeriesWhereInput = {};
      const query = request.query.q?.trim();
      if (query) {
        where.title = { contains: query, mode: 'insensitive' };
      }
      if (request.query.status && request.query.status !== 'all') {
        where.status = request.query.status;
      }
      if (request.query.updateStatus && request.query.updateStatus !== 'all') {
        where.updateStatus = request.query.updateStatus;
      }

      return app.prisma.series.findMany({
        where,
        orderBy: [
          { sortOrder: 'desc' },
          { lastPublishedEpisodeAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/series/:id/publish-checks',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const checks = await buildPublishChecks(app.prisma, request.params.id);
      if (!checks) return reply.code(404).send({ error: 'not_found' });
      return checks;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/series/:id/publish',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const result = await app.prisma.$transaction(async (tx) => {
        const series = await tx.series.findUnique({
          where: { id: request.params.id },
          include: { episodes: { select: { episodeNumber: true, status: true } } },
        });
        if (!series) return { result: 'not_found' as const };

        const checks = evaluatePublishChecksForSeries(series);
        if (checks.blockers.length > 0) {
          return { result: 'blocked' as const, checks };
        }

        const updated = await tx.series.update({
          where: { id: series.id },
          data: { status: 'published', publishedAt: series.publishedAt ?? new Date(), offlineAt: null },
        });

        await tx.adminAuditLog.create({
          data: {
            adminId: request.currentAdmin!.id,
            action: 'series.publish',
            targetType: 'series',
            targetId: series.id,
            seriesId: series.id,
            metadata: { from: series.status, to: 'published' },
          },
        });

        return { result: 'published' as const, series: updated };
      });

      if (result.result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result.result === 'blocked') {
        return reply.code(409).send({ error: 'publish_blocked', ...result.checks });
      }
      return result.series;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/series/:id/offline',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const result = await app.prisma.$transaction(async (tx) => {
        const series = await tx.series.findUnique({ where: { id: request.params.id } });
        if (!series) return { result: 'not_found' as const };

        const updated = await tx.series.update({
          where: { id: series.id },
          data: { status: 'offline', offlineAt: new Date() },
        });

        await tx.adminAuditLog.create({
          data: {
            adminId: request.currentAdmin!.id,
            action: 'series.offline',
            targetType: 'series',
            targetId: series.id,
            seriesId: series.id,
            metadata: { from: series.status, to: 'offline' },
          },
        });

        return { result: 'offline' as const, series: updated };
      });

      if (result.result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      return result.series;
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/series/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const series = await app.prisma.series.findUnique({ where: { id: request.params.id } });
      if (!series) return reply.code(404).send({ error: 'not_found' });
      const recentLogs = await app.prisma.adminAuditLog.findMany({
        where: { seriesId: series.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { admin: { select: { username: true } } },
      });
      return { series, recentLogs };
    }
  );

  async function buildPublishChecks(prisma: { series: Prisma.TransactionClient['series'] }, seriesId: string) {
    const series = await prisma.series.findUnique({
      where: { id: seriesId },
      include: { episodes: { select: { episodeNumber: true, status: true } } },
    });
    if (!series) return null;

    return evaluatePublishChecksForSeries(series);
  }

  function evaluatePublishChecksForSeries(series: {
    title: string;
    description: string | null;
    coverUrl: string | null;
    unlockPriceCents: number;
    freeEpisodeCount: number;
    updateStatus: string;
    episodes: { episodeNumber: number; status: string }[];
  }) {
    const publishedEpisodeCount = series.episodes.filter((episode) => episode.status === 'published').length;
    const processingEpisodeCount = series.episodes.filter((episode) => episode.status === 'processing').length;
    const failedEpisodeCount = series.episodes.filter((episode) => episode.status === 'failed').length;
    const draftEpisodeCount = series.episodes.filter((episode) => episode.status === 'draft').length;

    return evaluateSeriesPublishChecks({
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      unlockPriceCents: series.unlockPriceCents,
      freeEpisodeCount: series.freeEpisodeCount,
      updateStatus: series.updateStatus,
      publishedEpisodeCount,
      draftEpisodeCount,
      processingEpisodeCount,
      failedEpisodeCount,
      episodeNumbers: series.episodes.map((episode) => episode.episodeNumber),
    });
  }

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
    return app.prisma.series.findMany({
      where: { status: 'published' },
      orderBy: [
        { sortOrder: 'desc' },
        { lastPublishedEpisodeAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
  });

  app.get<{ Params: { id: string } }>('/api/series/:id', async (request, reply) => {
    const series = await app.prisma.series.findFirst({ where: { id: request.params.id, status: 'published' } });
    if (!series) return reply.code(404).send({ error: 'not_found' });
    return series;
  });
}
