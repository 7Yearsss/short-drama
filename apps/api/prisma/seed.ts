import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';
  await prisma.admin.upsert({
    where: { username },
    create: { username, passwordHash: await bcrypt.hash(password, 10) },
    update: {},
  });

  await prisma.membershipPlan.upsert({
    where: { id: 'monthly-plan' },
    create: { id: 'monthly-plan', name: '月度会员', priceCents: 29900, durationDays: 30 },
    update: {},
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
