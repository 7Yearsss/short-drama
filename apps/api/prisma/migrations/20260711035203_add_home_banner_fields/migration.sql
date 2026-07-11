-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "bannerOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isHomeBanner" BOOLEAN NOT NULL DEFAULT false;
