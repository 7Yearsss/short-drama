import { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<{ sub: string; role: string }>();
    if (payload.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    request.currentAdmin = { id: payload.sub };
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}
