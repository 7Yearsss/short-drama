'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import PlayerStage from '@/components/PlayerStage';
import { fetchEpisodes, fetchPlaybackUrl, fetchSeriesDetail, Episode, Series } from '@/lib/api-client';
import { getStoredToken, mockLineLogin } from '@/lib/liff-mock';

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetchSeriesDetail(params.id).then(setSeries);
    fetchEpisodes(params.id).then(setEpisodes);
  }, [params.id]);

  async function play(episode: Episode) {
    setActiveEpisodeId(episode.id);
    setLocked(false);
    setPlaybackUrl(null);
    const token = getStoredToken() ?? undefined;
    const result = await fetchPlaybackUrl(episode.id, token);
    if ('locked' in result) {
      setLocked(true);
      return;
    }
    setPlaybackUrl(result.url);
  }

  async function login() {
    await mockLineLogin();
  }

  const freeEpisodeCount = series?.freeEpisodeCount ?? 0;
  const isFreeSeries = series?.unlockPriceCents === 0;
  const firstEpisode = episodes[0];
  const activeIndex = episodes.findIndex((episode) => episode.id === activeEpisodeId);
  const nextEpisode = activeIndex >= 0 ? episodes[activeIndex + 1] : undefined;

  return (
    <>
      <TopBar />
      <main className="series-page">
        <div className="series-layout">
          <PlayerStage
            coverUrl={series?.coverUrl ?? null}
            playbackUrl={playbackUrl}
            locked={locked}
            onRequestPlay={() => firstEpisode && play(firstEpisode)}
            onRequestLogin={login}
            onEnded={() => nextEpisode && play(nextEpisode)}
          />

          <div className="series-detail">
            <div className="series-title-row">
              <div className="eyebrow">短剧详情</div>
              <h1>{series?.title ?? '加载中…'}</h1>
              {series?.description && <p className="series-desc">{series.description}</p>}
            </div>

            <section className="episode-panel">
              <div className="episode-head">
                <h3>选集</h3>
                <span>共 {episodes.length} 集</span>
              </div>
              <div className="episode-grid">
                {episodes.map((episode) => (
                  <button
                    key={episode.id}
                    className={`episode-btn ${episode.id === activeEpisodeId ? 'is-active' : ''} ${
                      !isFreeSeries && episode.episodeNumber > freeEpisodeCount ? 'is-locked' : ''
                    }`}
                    onClick={() => play(episode)}
                  >
                    {!isFreeSeries && episode.episodeNumber > freeEpisodeCount ? '锁' : episode.episodeNumber}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
