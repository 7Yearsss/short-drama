'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchEpisodes, fetchPlaybackUrl, Episode } from '@/lib/api-client';
import { getStoredToken, mockLineLogin } from '@/lib/liff-mock';

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetchEpisodes(params.id).then(setEpisodes);
  }, [params.id]);

  async function play(episodeId: string) {
    setLocked(false);
    setPlaybackUrl(null);
    const token = getStoredToken() ?? undefined;
    const result = await fetchPlaybackUrl(episodeId, token);
    if ('locked' in result) {
      setLocked(true);
      return;
    }
    setPlaybackUrl(result.url);
  }

  async function login() {
    await mockLineLogin();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>剧集列表</h1>
      <ul>
        {episodes.map((ep) => (
          <li key={ep.id}>
            <button onClick={() => play(ep.id)}>
              第{ep.episodeNumber}集 {ep.title}
            </button>
          </li>
        ))}
      </ul>
      {playbackUrl && <video controls width={640} src={playbackUrl} />}
      {locked && (
        <div>
          <p>这一集需要登录后解锁/开通会员才能观看。</p>
          <button onClick={login}>LINE 登录（开发模拟）</button>
        </div>
      )}
    </main>
  );
}
