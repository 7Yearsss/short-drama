-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "offlineAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "replacementDurationSeconds" INTEGER,
ADD COLUMN     "replacementR2Key" TEXT,
ADD COLUMN     "replacementStatus" TEXT,
ADD COLUMN     "replacementTempVideoPath" TEXT,
ADD COLUMN     "replacementUploadError" TEXT;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "lastPublishedEpisodeAt" TIMESTAMP(3),
ADD COLUMN     "offlineAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updateStatus" TEXT NOT NULL DEFAULT 'ongoing';

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "seriesId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_seriesId_createdAt_idx" ON "AdminAuditLog"("seriesId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
