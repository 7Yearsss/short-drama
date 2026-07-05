import Fastify, { FastifyInstance } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { healthRoutes } from './routes/health.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { userAuthRoutes } from './routes/user-auth.js';
import { seriesRoutes } from './routes/series.js';

export interface BuildAppOptions {
  prisma?: PrismaClient;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const prisma = opts.prisma ?? new PrismaClient();

  app.decorate('prisma', prisma);
  app.register(jwtPlugin, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });

  app.register(healthRoutes);
  app.register(adminAuthRoutes);
  app.register(userAuthRoutes);
  app.register(seriesRoutes);

  app.addHook('onClose', async () => {
    if (!opts.prisma) {
      await prisma.$disconnect();
    }
  });

  return app;
}
