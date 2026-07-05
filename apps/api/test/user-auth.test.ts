import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';

const prisma = new PrismaClient();

describe('POST /api/auth/line', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a new user on first login', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/line',
      payload: { lineUid: 'U123', nickname: 'Ken' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.user.lineUid).toBe('U123');
    const count = await prisma.user.count();
    expect(count).toBe(1);
    await app.close();
  });

  it('reuses the same user on subsequent logins with the same lineUid', async () => {
    const app = buildApp({ prisma });
    await app.inject({ method: 'POST', url: '/api/auth/line', payload: { lineUid: 'U123', nickname: 'Ken' } });
    await app.inject({ method: 'POST', url: '/api/auth/line', payload: { lineUid: 'U123', nickname: 'Ken Xu' } });
    const count = await prisma.user.count();
    expect(count).toBe(1);
    await app.close();
  });

  it('rejects a request missing lineUid', async () => {
    const app = buildApp({ prisma });
    const res = await app.inject({ method: 'POST', url: '/api/auth/line', payload: { nickname: 'Ken' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
