-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "tempVideoPath" TEXT,
ADD COLUMN     "uploadError" TEXT,
ALTER COLUMN "r2Key" DROP NOT NULL;
