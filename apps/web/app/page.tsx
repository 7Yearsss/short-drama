'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/components/TopBar';
import BottomNav from '@/components/BottomNav';
import { fetchSeriesList, Series } from '@/lib/api-client';
import { formatPriceCents } from '@/lib/format';

const UPDATE_STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
  paused: '暂停更新',
};

export default function HomePage() {
  const [seriesList, setSeriesList] = useState<Series[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchSeriesList().then(setSeriesList);
  }, []);

  const filtered = useMemo(() => {
    if (!seriesList) return [];
    const q = query.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter((s) => [s.title, s.description ?? ''].join(' ').toLowerCase().includes(q));
  }, [seriesList, query]);

  return (
    <>
      <TopBar searchValue={query} onSearchChange={setQuery} />
      <main className="home-page">
        <header className="home-intro">
          <h1>短剧馆</h1>
          <p>精选短剧持续上新，点开即看，前几集免费，会员解锁全集。</p>
        </header>

        <section className="featured-row">
          <article className="membership-card">
            <div>
              <div className="eyebrow">VIP</div>
              <h2>会员抢先看</h2>
              <p>解锁全集、无广告播放、高清画质。</p>
            </div>
            <Link href="/membership" className="vip-btn">
              开通会员
            </Link>
          </article>
        </section>

        <section className="section-head">
          <h2>正在流行</h2>
          {seriesList && <span className="view-status">{filtered.length} 部短剧</span>}
        </section>

        <section className="video-grid" aria-live="polite">
          {seriesList === null && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton-card" />)}

          {seriesList !== null && filtered.length === 0 && (
            <div className="empty-state">
              <div>
                <h3>{seriesList.length === 0 ? '暂无上架剧集' : '没有找到匹配短剧'}</h3>
                <p>{seriesList.length === 0 ? '内容马上就来，欢迎稍后再看看。' : '换个关键词试试。'}</p>
              </div>
            </div>
          )}

          {filtered.map((series) => (
            <Link key={series.id} href={`/series/${series.id}`} className="video-card">
              <div
                className="thumb"
                style={series.coverUrl ? { backgroundImage: `url(${series.coverUrl})` } : undefined}
              >
                <span className="tag">
                  {series.unlockPriceCents === 0 ? '免费观看' : `前 ${series.freeEpisodeCount} 集免费`}
                </span>
              </div>
              <div className="video-body">
                <strong className="video-title">{series.title}</strong>
                {series.description && <p className="video-desc">{series.description}</p>}
                <div className="video-meta">
                  {UPDATE_STATUS_LABEL[series.updateStatus] ?? '连载中'} ·{' '}
                  {series.unlockPriceCents === 0 ? '免费观看' : `解锁全集 ${formatPriceCents(series.unlockPriceCents)}`}
                </div>
              </div>
            </Link>
          ))}
        </section>
      </main>
      <BottomNav />
    </>
  );
}
