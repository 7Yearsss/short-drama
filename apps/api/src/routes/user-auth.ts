import { FastifyInstance } from 'fastify';

export async function userAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { lineUid: string; nickname: string; avatarUrl?: string } }>(
    '/api/auth/line',
    async (request, reply) => {
      const { lineUid, nickname, avatarUrl } = request.body ?? {};
      if (!lineUid || !nickname) {
        return reply.code(400).send({ error: 'lineUid and nickname required' });
      }
      // This endpoint trusts the client-supplied lineUid because no LIFF domain is
      // registered yet for local dev; production must replace this with real LIFF
      // ID token verification before going live.
      const user = await app.prisma.user.upsert({
        where: { lineUid },
        create: { lineUid, nickname, avatarUrl },
        update: { nickname, avatarUrl },
      });
      const token = app.jwt.sign({ sub: user.id, role: 'user' }, { expiresIn: '30d' });
      return { token, user };
    }
  );
}
