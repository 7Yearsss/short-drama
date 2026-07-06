'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

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
    <div className="admin-shell">
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-title">
            <h1>集数管理</h1>
            <p>新增集数请用本地上传工具（tools/uploader）注册，这里只负责上下架。</p>
          </div>
          <div className="admin-actions">
            <Link href="/admin" className="admin-btn">
              返回剧集列表
            </Link>
          </div>
        </header>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>集数列表</h2>
              <p>集数、标题、状态与上架操作。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>集数</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((ep) => (
                  <tr key={ep.id}>
                    <td>第 {ep.episodeNumber} 集</td>
                    <td>{ep.title}</td>
                    <td>
                      <span className={`status ${ep.status === 'published' ? 'published' : 'draft'}`}>
                        {ep.status === 'published' ? '已上架' : '草稿'}
                      </span>
                    </td>
                    <td>
                      {ep.status !== 'published' && (
                        <button className="admin-btn" onClick={() => publish(ep.id)}>
                          上架
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </main>
    </div>
  );
}
