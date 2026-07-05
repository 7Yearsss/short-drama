import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/require-admin.js';

export async function grantRoutes(app: FastifyInstance) {
  app.post<{ Body: { userId: string; planId: string } }>(
    '/api/admin/grants/membership',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { userId, planId } = request.body;
      const plan = await app.prisma.membershipPlan.findUnique({ where: { id: planId } });
      if (!plan) return reply.code(404).send({ error: 'plan_not_found' });
      const activeMembership = await app.prisma.membership.findFirst({
        where: { userId, endAt: { gt: new Date() } },
        orderBy: { endAt: 'desc' },
      });
      const startAt = activeMembership ? activeMembership.endAt : new Date();
      const endAt = new Date(startAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
      return app.prisma.membership.create({ data: { userId, planId, startAt, endAt, source: 'manual' } });
    }
  );

  app.post<{ Body: { userId: string; seriesId: string } }>(
    '/api/admin/grants/series-unlock',
    { preHandler: requireAdmin },
    async (request) => {
      const { userId, seriesId } = request.body;
      return app.prisma.seriesUnlock.upsert({
        where: { userId_seriesId: { userId, seriesId } },
        create: { userId, seriesId, source: 'manual' },
        update: {},
      });
    }
  );
}
