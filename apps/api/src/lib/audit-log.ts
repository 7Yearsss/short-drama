import type { Prisma, PrismaClient } from '@prisma/client';

export interface AuditLogInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  seriesId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAdminAuditLog(prisma: PrismaClient, input: AuditLogInput) {
  return prisma.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      seriesId: input.seriesId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
