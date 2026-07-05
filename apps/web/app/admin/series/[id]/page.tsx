'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  status: string;
}

function authHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function AdminSeriesEpisodesPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  async function load() {
    const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/episodes`, { headers: authHeaders() });
    setEpisodes(await res.json());
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function publish(id: string) {
    await fetch(`${API_BASE_URL}/api/admin/episodes/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'published' }),
    });
    load();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>集数管理</h1>
      <p>新增集数请用本地上传工具（<code>tools/uploader</code>）注册，这里只负责上下架。</p>
      <ul>
        {episodes.map((ep) => (
          <li key={ep.id}>
            第{ep.episodeNumber}集 {ep.title} — {ep.status}
            {ep.status !== 'published' && (
              <button onClick={() => publish(ep.id)} style={{ marginLeft: 8 }}>
                上架
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
