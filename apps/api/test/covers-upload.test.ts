import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { cleanDb } from './helpers/clean-db.js';
import { multipartPayload } from './helpers/multipart.js';

const uploadCoverImage = vi.hoisted(() => vi.fn().mockResolvedValue('https://pub-example.r2.dev/abc.jpg'));

vi.mock('../src/lib/covers-r2.js', () => ({
  uploadCoverImage,
}));

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { username: 'boss', password: 'secret123' },
  });
  return res.json().token as string;
}

async function coverUploadPayload(contentType = 'image/jpeg', fieldName = 'cover', content = Buffer.from('fake image bytes')) {
  return multipartPayload({
    fields: {},
    file: {
      fieldName,
      filename: contentType === 'image/png' ? 'cover.png' : 'cover.jpg',
      contentType,
      content,
    },
  });
}

async function noFilePayload() {
  return multipartPayload({ fields: {} });
}

describe('POST /api/admin/covers/upload', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await cleanDb(prisma);
    uploadCoverImage.mockReset();
    uploadCoverImage.mockResolvedValue('https://pub-example.r2.dev/abc.jpg');
    app = buildApp({ prisma });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uploads an image file for an authenticated admin', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://pub-example.r2.dev/abc.jpg' });
    expect(uploadCoverImage).toHaveBeenCalledTimes(1);
    expect(uploadCoverImage).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/), Buffer.from('fake image bytes'), 'image/jpeg');
  });

  it('uses a png key extension for PNG uploads', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload('image/png');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(200);
    expect(uploadCoverImage).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), Buffer.from('fake image bytes'), 'image/png');
  });

  it('rejects a non-image file', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload('text/plain');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_file_type' });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('rejects unsupported image types', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload('image/webp');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_file_type' });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('rejects oversized cover files', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload('image/jpeg', 'cover', Buffer.alloc(5 * 1024 * 1024 + 1));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'file_too_large' });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('rejects a file uploaded with the wrong field name', async () => {
    const token = await adminToken(app);
    const multipart = await coverUploadPayload('image/jpeg', 'poster');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'file_required' });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('rejects multipart requests without a file', async () => {
    const token = await adminToken(app);
    const multipart = await noFilePayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: { authorization: `Bearer ${token}`, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'file_required' });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('requires admin authentication', async () => {
    const multipart = await coverUploadPayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/covers/upload',
      headers: multipart.headers,
      payload: multipart.payload,
    });

    expect(res.statusCode).toBe(401);
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });
});
