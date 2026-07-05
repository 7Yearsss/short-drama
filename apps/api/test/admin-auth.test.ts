import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

describe('POST /api/admin/login', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns a token for valid credentials', async () => {
    await prisma.admin.create({
      data: { username: 'boss', passwordHash: await hashPassword('secret123') },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'boss', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf('string');
    await app.close();
  });

  it('rejects an invalid password', async () => {
    await prisma.admin.create({
      data: { username: 'boss', passwordHash: await hashPassword('secret123') },
    });
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'boss', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an unknown username', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'nobody', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
