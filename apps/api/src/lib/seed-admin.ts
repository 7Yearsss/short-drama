import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password.js';

export async function ensureAdminExists(prisma: PrismaClient): Promise<void> {
  const count = await prisma.admin.count();
  if (count > 0) {
    console.log('admin already exists, skipping auto-seed');
    return;
  }

  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';

  await prisma.admin.create({
    data: { username, passwordHash: await hashPassword(password) },
  });
  console.log(`no admin found, auto-created default admin account: ${username}`);
}
