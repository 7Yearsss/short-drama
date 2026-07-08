import { FastifyInstance } from 'fastify';
import { optionalUser } from '../middleware/optional-user.js';
import { hasAccessToEpisode } from '../lib/access-control.js';
import { getPlaybackUrl } from '../lib/r2.js';

export async function playbackRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/api/episodes/:id/playback',
    { preHandler: optionalUser },
    async (request, reply) => {
      const episode = await app.prisma.episode.findUnique({ where: { id: request.params.id } });
      if (!episode || episode.status !== 'published') {
        return reply.code(404).send({ error: 'not_found' });
      }
      const series = await app.prisma.series.findUnique({ where: { id: episode.seriesId } });
      if (!series || series.status !== 'published') {
        return reply.code(404).send({ error: 'not_found' });
      }
      const allowed = await hasAccessToEpisode(app.prisma, request.currentUser?.id, episode, series);
      if (!allowed) {
        return reply.code(403).send({ error: 'locked' });
      }
      if (!episode.r2Key) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const url = await getPlaybackUrl(episode.r2Key);
      return { url, expiresIn: 300 };
    }
  );
}
