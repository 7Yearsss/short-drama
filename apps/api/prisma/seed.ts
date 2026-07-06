import { PrismaClient } from '@prisma/client';
import { ensureAdminExists } from '../src/lib/seed-admin.js';

const prisma = new PrismaClient();

async function main() {
  await ensureAdminExists(prisma);

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
