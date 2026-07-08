import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { cleanDb } from './helpers/clean-db.js';
import { hasAccessToEpisode } from '../src/lib/access-control.js';

const prisma = new PrismaClient();

describe('hasAccessToEpisode', () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeSeries(freeEpisodeCount = 2) {
    return prisma.series.create({ data: { title: 'Test Series', freeEpisodeCount } });
  }

  it('allows anonymous access to a free episode', async () => {
    const series = await makeSeries(2);
    const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 1 }, series);
    expect(allowed).toBe(true);
  });

  it('allows every episode of a free series without login', async () => {
    const series = await prisma.series.create({
      data: { title: 'Free Show', freeEpisodeCount: 0, unlockPriceCents: 0 },
    });

    const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 99 }, series);

    expect(allowed).toBe(true);
  });

  it('denies anonymous access to a locked episode', async () => {
    const series = await makeSeries(2);
    const allowed = await hasAccessToEpisode(prisma, undefined, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('denies a logged-in user with no membership or unlock', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('allows a user with an active membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });
    await prisma.membership.create({
      data: { userId: user.id, planId: plan.id, endAt: new Date(Date.now() + 1000 * 60 * 60) },
    });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(true);
  });

  it('denies a user with an expired membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    const plan = await prisma.membershipPlan.create({ data: { name: 'Monthly', priceCents: 29900, durationDays: 30 } });
    await prisma.membership.create({
      data: { userId: user.id, planId: plan.id, endAt: new Date(Date.now() - 1000) },
    });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(false);
  });

  it('allows a user with a series unlock, even without membership', async () => {
    const series = await makeSeries(2);
    const user = await prisma.user.create({ data: { lineUid: 'U1', nickname: 'Ken' } });
    await prisma.seriesUnlock.create({ data: { userId: user.id, seriesId: series.id } });
    const allowed = await hasAccessToEpisode(prisma, user.id, { episodeNumber: 3 }, series);
    expect(allowed).toBe(true);
  });
});
