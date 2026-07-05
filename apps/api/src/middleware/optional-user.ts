import { FastifyReply, FastifyRequest } from 'fastify';

export async function optionalUser(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.headers.authorization) return;
  try {
    const payload = await request.jwtVerify<{ sub: string; role: string }>();
    if (payload.role === 'user') {
      request.currentUser = { id: payload.sub };
    }
  } catch {
    // invalid/expired token: treat the request as anonymous
  }
}
