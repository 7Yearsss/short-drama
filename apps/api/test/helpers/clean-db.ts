import { PrismaClient } from '@prisma/client';

export async function cleanDb(prisma: PrismaClient) {
  await prisma.adminAuditLog.deleteMany();
  await prisma.seriesUnlock.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.series.deleteMany();
  await prisma.membershipPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
}
