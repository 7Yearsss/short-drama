import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../middleware/require-admin.js';
import { uploadCoverImage } from '../lib/covers-r2.js';

const COVER_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const COVER_EXTENSIONS: Record<string, 'jpg' | 'png'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function isFileSizeLimitError(error: unknown) {
  return (
    error instanceof Error &&
    ('code' in error || 'statusCode' in error) &&
    ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || (error as { statusCode?: number }).statusCode === 413)
  );
}

export async function coverRoutes(app: FastifyInstance) {
  app.post('/api/admin/covers/upload', { preHandler: requireAdmin }, async (request, reply) => {
    let data;
    try {
      data = await request.file({
        limits: { fileSize: COVER_FILE_SIZE_LIMIT_BYTES },
        throwFileSizeLimit: true,
      });
    } catch (error) {
      if (isFileSizeLimitError(error)) {
        return reply.code(413).send({ error: 'file_too_large' });
      }
      throw error;
    }
    if (!data || data.fieldname !== 'cover') {
      return reply.code(400).send({ error: 'file_required' });
    }
    const ext = COVER_EXTENSIONS[data.mimetype];
    if (!ext) {
      return reply.code(400).send({ error: 'invalid_file_type' });
    }

    let buffer;
    try {
      buffer = await data.toBuffer();
    } catch (error) {
      if (isFileSizeLimitError(error)) {
        return reply.code(413).send({ error: 'file_too_large' });
      }
      throw error;
    }
    const key = `${randomUUID()}.${ext}`;
    const url = await uploadCoverImage(key, buffer, data.mimetype);
    return { url };
  });
}
