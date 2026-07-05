import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { cleanDb } from './helpers/clean-db.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function adminToken(app: ReturnType<typeof buildApp>) {
  await prisma.admin.create({ data: { username: 'boss', passwordHash: await hashPassword('secret123') } });
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'boss', password: 'secret123' } });
  return res.json().token as string;
}

describe('grant routes', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('grants a membership to a user', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/membership',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, planId: plan.id },
    });
    expect(res.statusCode).toBe(200);
    const count = await prisma.membership.count({ where: { userId: user.id } });
    expect(count).toBe(1);
    await app.close();
  });

  it('returns 404 for an unknown plan', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/membership',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, planId: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('grants a series unlock to a user, idempotently', async () => {
    const app = buildApp({ prisma });
    const token = await adminToken(app);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const series = await prisma.series.create({ data: { title: 'Test' } });

    await app.inject({
      method: 'POST',
      url: '/api/admin/grants/series-unlock',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, seriesId: series.id },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/grants/series-unlock',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: user.id, seriesId: series.id },
    });
    expect(res.statusCode).toBe(200);
    const count = await prisma.seriesUnlock.count({ where: { userId: user.id, seriesId: series.id } });
    expect(count).toBe(1);
    await app.close();
  });
});
