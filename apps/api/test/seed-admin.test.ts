import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ensureAdminExists } from '../src/lib/seed-admin.js';
import { verifyPassword } from '../src/lib/password.js';
import { cleanDb } from './helpers/clean-db.js';

const prisma = new PrismaClient();

describe('ensureAdminExists', () => {
  const originalUsername = process.env.SEED_ADMIN_USERNAME;
  const originalPassword = process.env.SEED_ADMIN_PASSWORD;

  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterEach(() => {
    process.env.SEED_ADMIN_USERNAME = originalUsername;
    process.env.SEED_ADMIN_PASSWORD = originalPassword;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an admin from env vars when none exist', async () => {
    process.env.SEED_ADMIN_USERNAME = 'testadmin';
    process.env.SEED_ADMIN_PASSWORD = 'testpass123';

    await ensureAdminExists(prisma);

    const admins = await prisma.admin.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0].username).toBe('testadmin');
    expect(await verifyPassword('testpass123', admins[0].passwordHash)).toBe(true);
  });

  it('does not create a second admin when one already exists', async () => {
    await prisma.admin.create({
      data: { username: 'existing', passwordHash: 'irrelevant-hash' },
    });

    await ensureAdminExists(prisma);

    const admins = await prisma.admin.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0].username).toBe('existing');
  });
});
