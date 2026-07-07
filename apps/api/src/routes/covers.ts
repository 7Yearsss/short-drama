import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../middleware/require-admin.js';
import { uploadCoverImage } from '../lib/covers-r2.js';

export async function coverRoutes(app: FastifyInstance) {
  app.post('/api/admin/covers/upload', { preHandler: requireAdmin }, async (request, reply) => {
    const data = await request.file();
    if (!data || data.fieldname !== 'cover') {
      return reply.code(400).send({ error: 'file_required' });
    }
    if (!data.mimetype.startsWith('image/')) {
      return reply.code(400).send({ error: 'invalid_file_type' });
    }

    const buffer = await data.toBuffer();
    const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `${randomUUID()}.${ext}`;
    const url = await uploadCoverImage(key, buffer, data.mimetype);
    return { url };
  });
}
