import Fastify, { FastifyInstance } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { userAuthRoutes } from './routes/user-auth.js';
import { seriesRoutes } from './routes/series.js';
import { episodeRoutes } from './routes/episodes.js';
import { playbackRoutes } from './routes/playback.js';
import { grantRoutes } from './routes/grants.js';

export interface BuildAppOptions {
  prisma?: PrismaClient;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const prisma = opts.prisma ?? new PrismaClient();

  app.decorate('prisma', prisma);
  // In production, set CORS_ORIGIN to the deployed web app's exact origin.
  // Defaults to '*' for local dev when unset.
  app.register(cors, { origin: process.env.CORS_ORIGIN ?? '*' });
  app.register(jwtPlugin, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });
  app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  app.register(healthRoutes);
  app.register(adminAuthRoutes);
  app.register(userAuthRoutes);
  app.register(seriesRoutes);
  app.register(episodeRoutes);
  app.register(playbackRoutes);
  app.register(grantRoutes);

  app.addHook('onClose', async () => {
    if (!opts.prisma) {
      await prisma.$disconnect();
    }
  });

  return app;
}
