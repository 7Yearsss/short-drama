'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
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

  return (
    <>
      <TopBar />
      <main className="series-page">
        <div className="series-layout">
          <div className="player-stage">
            {playbackUrl ? (
              <video controls autoPlay src={playbackUrl} />
            ) : (
              <div className="player-placeholder">
                <span className="player-big-play" aria-hidden="true">
                  ▶
                </span>
              </div>
            )}
          </div>

          <div className="series-detail">
            <div className="series-title-row">
              <div className="eyebrow">短剧详情</div>
              <h1>{series?.title ?? '加载中…'}</h1>
              {series?.description && <p className="series-desc">{series.description}</p>}
            </div>

            {locked && (
              <div className="unlock-card">
                <div>
                  <strong>这一集需要解锁</strong>
                  <span>登录后可解锁全集或开通会员观看。</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secondary-btn" onClick={login}>
                    LINE 登录
                  </button>
                  <Link href="/membership" className="vip-btn">
                    去解锁
                  </Link>
                </div>
              </div>
            )}

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
                      episode.episodeNumber > freeEpisodeCount ? 'is-locked' : ''
                    }`}
                    onClick={() => play(episode)}
                  >
                    {episode.episodeNumber > freeEpisodeCount ? '锁' : episode.episodeNumber}
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
