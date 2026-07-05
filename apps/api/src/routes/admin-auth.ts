import { FastifyInstance } from 'fastify';
import { verifyPassword } from '../lib/password.js';

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/admin/login',
    async (request, reply) => {
      const { username, password } = request.body;
      const admin = await app.prisma.admin.findUnique({ where: { username } });
      if (!admin) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const valid = await verifyPassword(password, admin.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const token = app.jwt.sign({ sub: admin.id, role: 'admin' }, { expiresIn: '12h' });
      return { token };
    }
  );
}
