import { PrismaClient } from '@prisma/client';

export async function hasAccessToEpisode(
  prisma: PrismaClient,
  userId: string | undefined,
  episode: { episodeNumber: number },
  series: { id: string; freeEpisodeCount: number; unlockPriceCents: number }
): Promise<boolean> {
  if (series.unlockPriceCents === 0) {
    return true;
  }
  if (episode.episodeNumber <= series.freeEpisodeCount) {
    return true;
  }
  if (!userId) {
    return false;
  }
  const activeMembership = await prisma.membership.findFirst({
    where: { userId, endAt: { gt: new Date() } },
  });
  if (activeMembership) {
    return true;
  }
  const unlock = await prisma.seriesUnlock.findUnique({
    where: { userId_seriesId: { userId, seriesId: series.id } },
  });
  return unlock !== null;
}
