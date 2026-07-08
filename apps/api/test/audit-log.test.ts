import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { cleanDb } from './helpers/clean-db.js';
import { recordAdminAuditLog } from '../src/lib/audit-log.js';

const prisma = new PrismaClient();

describe('recordAdminAuditLog', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records a content operation for a series', async () => {
    const admin = await prisma.admin.create({ data: { username: 'boss', passwordHash: 'hash' } });
    const series = await prisma.series.create({ data: { title: 'Test Series' } });

    await recordAdminAuditLog(prisma, {
      adminId: admin.id,
      action: 'series.publish',
      targetType: 'series',
      targetId: series.id,
      seriesId: series.id,
      metadata: { from: 'draft', to: 'published' },
    });

    const log = await prisma.adminAuditLog.findFirstOrThrow();
    expect(log.adminId).toBe(admin.id);
    expect(log.action).toBe('series.publish');
    expect(log.targetType).toBe('series');
    expect(log.targetId).toBe(series.id);
    expect(log.seriesId).toBe(series.id);
    expect(log.metadata).toEqual({ from: 'draft', to: 'published' });
  });
});
