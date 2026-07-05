import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    currentAdmin?: { id: string };
    currentUser?: { id: string };
  }
}
