const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export interface Series {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  freeEpisodeCount: number;
  unlockPriceCents: number;
  updateStatus: string;
  sortOrder: number;
  lastPublishedEpisodeAt: string | null;
}

export interface BannerSeries {
  id: string;
  title: string;
  coverUrl: string | null;
  unlockPriceCents: number;
  freeEpisodeCount: number;
}

export interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  durationSeconds: number | null;
}

export async function fetchSeriesList(): Promise<Series[]> {
  const res = await fetch(`${API_BASE_URL}/api/series`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load series');
  return res.json();
}

export async function fetchHomeBanners(): Promise<BannerSeries[]> {
  const res = await fetch(`${API_BASE_URL}/api/series/banners`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load home banners');
  return res.json();
}

export async function fetchSeriesDetail(seriesId: string): Promise<Series> {
  const res = await fetch(`${API_BASE_URL}/api/series/${seriesId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load series detail');
  return res.json();
}

export async function fetchEpisodes(seriesId: string): Promise<Episode[]> {
  const res = await fetch(`${API_BASE_URL}/api/series/${seriesId}/episodes`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to load episodes');
  return res.json();
}

export async function fetchPlaybackUrl(
  episodeId: string,
  token?: string
): Promise<{ url: string } | { locked: true }> {
  const res = await fetch(`${API_BASE_URL}/api/episodes/${episodeId}/playback`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (res.status === 403) return { locked: true };
  if (!res.ok) throw new Error('failed to load playback url');
  return res.json();
}
