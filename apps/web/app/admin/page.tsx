'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Series {
  id: string;
  title: string;
  status: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
}

function authHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function AdminDashboardPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [title, setTitle] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantSeriesId, setGrantSeriesId] = useState('');

  async function loadSeries() {
    const res = await fetch(`${API_BASE_URL}/api/admin/series`, { headers: authHeaders() });
    setSeriesList(await res.json());
  }

  useEffect(() => {
    loadSeries();
  }, []);

  async function createSeries(e: FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE_URL}/api/admin/series`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title }),
    });
    setTitle('');
    loadSeries();
  }

  async function publishSeries(id: string) {
    await fetch(`${API_BASE_URL}/api/admin/series/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'published' }),
    });
    loadSeries();
  }

  async function grantSeriesUnlock(e: FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE_URL}/api/admin/grants/series-unlock`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId: grantUserId, seriesId: grantSeriesId }),
    });
    alert('已解锁');
  }

  return (
    <main style={{ padding: 24, display: 'grid', gap: 24 }}>
      <h1>管理后台</h1>

      <section>
        <h2>新建剧集</h2>
        <form onSubmit={createSeries} style={{ display: 'flex', gap: 8 }}>
          <input placeholder="剧名" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">创建</button>
        </form>
      </section>

      <section>
        <h2>剧集列表</h2>
        <ul>
          {seriesList.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/series/${s.id}`}>{s.title}</Link> — {s.status} — 免费{s.freeEpisodeCount}集 — 解锁价NT${(s.unlockPriceCents / 100).toFixed(0)}
              {s.status !== 'published' && (
                <button onClick={() => publishSeries(s.id)} style={{ marginLeft: 8 }}>
                  上架
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>手动开通剧集解锁</h2>
        <form onSubmit={grantSeriesUnlock} style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
          <input placeholder="User ID" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} />
          <input placeholder="Series ID" value={grantSeriesId} onChange={(e) => setGrantSeriesId(e.target.value)} />
          <button type="submit">解锁</button>
        </form>
      </section>
    </main>
  );
}
