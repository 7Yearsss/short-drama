'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantSeriesId, setGrantSeriesId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const creatingRef = useRef(false);

  async function loadSeries() {
    const res = await fetch(`${API_BASE_URL}/api/admin/series`, { headers: authHeaders() });
    setSeriesList(await res.json());
  }

  useEffect(() => {
    loadSeries();
  }, []);

  async function createSeries(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creatingRef.current) return;

    const form = e.currentTarget;
    creatingRef.current = true;
    setCreating(true);
    setCreateError('');
    let fallbackErrorMessage = '创建失败，请稍后重试';

    try {
      let coverUrl: string | undefined;

      if (coverFile) {
        fallbackErrorMessage = '封面上传失败，请稍后重试';
        const token = localStorage.getItem('sd_admin_token');
        const formData = new FormData();
        formData.append('cover', coverFile);

        const uploadRes = await fetch(`${API_BASE_URL}/api/admin/covers/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!uploadRes.ok) {
          setCreateError('封面上传失败，请重试');
          return;
        }

        const uploadedCover = (await uploadRes.json()) as { url?: string };
        if (!uploadedCover.url) {
          setCreateError('封面上传失败，请重试');
          return;
        }
        coverUrl = uploadedCover.url;
      }

      fallbackErrorMessage = '创建失败，请稍后重试';
      const createRes = await fetch(`${API_BASE_URL}/api/admin/series`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title, coverUrl }),
      });

      if (!createRes.ok) {
        setCreateError('创建剧集失败，请重试');
        return;
      }

      setTitle('');
      setCoverFile(null);
      form.reset();
      setDrawerOpen(false);
      loadSeries();
    } catch {
      setCreateError(fallbackErrorMessage);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
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

  const publishedCount = seriesList.filter((s) => s.status === 'published').length;
  const draftCount = seriesList.length - publishedCount;

  return (
    <div className="admin-shell">
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-title">
            <h1>内容管理</h1>
            <p>上传 / 编辑短剧、维护上架状态。后台仅管理员登录后可见。</p>
          </div>
          <div className="admin-actions">
            <Link href="/" className="admin-btn">
              返回前台
            </Link>
            <button
              className="admin-btn admin-primary"
              onClick={() => {
                setCreateError('');
                setDrawerOpen(true);
              }}
            >
              新建剧集
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card">
            <span>总剧集</span>
            <strong>{seriesList.length}</strong>
          </article>
          <article className="stat-card">
            <span>已上架</span>
            <strong>{publishedCount}</strong>
          </article>
          <article className="stat-card">
            <span>草稿</span>
            <strong>{draftCount}</strong>
          </article>
        </section>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>剧集列表</h2>
              <p>剧名、状态、免费集数、解锁价格。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>剧名</th>
                  <th>状态</th>
                  <th>免费集数</th>
                  <th>解锁价格</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {seriesList.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/admin/series/${s.id}`}>{s.title}</Link>
                    </td>
                    <td>
                      <span className={`status ${s.status === 'published' ? 'published' : 'draft'}`}>
                        {s.status === 'published' ? '已上架' : '草稿'}
                      </span>
                    </td>
                    <td>{s.freeEpisodeCount}</td>
                    <td>NT${(s.unlockPriceCents / 100).toFixed(0)}</td>
                    <td>
                      {s.status !== 'published' && (
                        <button className="admin-btn" onClick={() => publishSeries(s.id)}>
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

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>手动开通剧集解锁</h2>
              <p>支付接入前的临时授予方式。</p>
            </div>
          </div>
          <form className="form-grid" style={{ padding: 16 }} onSubmit={grantSeriesUnlock}>
            <div className="field">
              <label htmlFor="grantUserId">User ID</label>
              <input id="grantUserId" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grantSeriesId">Series ID</label>
              <input id="grantSeriesId" value={grantSeriesId} onChange={(e) => setGrantSeriesId(e.target.value)} />
            </div>
            <button className="admin-btn admin-primary" type="submit">
              解锁
            </button>
          </form>
        </article>
      </main>

      <div className={`drawer-backdrop ${drawerOpen ? 'is-open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <section className={`drawer-panel ${drawerOpen ? 'is-open' : ''}`}>
        <div className="drawer-head">
          <h2>新建剧集</h2>
          <button className="close-btn" onClick={() => setDrawerOpen(false)} aria-label="关闭">
            ×
          </button>
        </div>
        <form className="form-grid" onSubmit={createSeries}>
          <div className="field">
            <label htmlFor="newTitle">剧名</label>
            <input id="newTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="newCover">封面图片（可选）</label>
            <input id="newCover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
          </div>
          {createError && (
            <p className="error-text" role="alert">
              {createError}
            </p>
          )}
          <button className="admin-btn admin-primary" type="submit" disabled={creating}>
            {creating ? '创建中…' : '创建'}
          </button>
        </form>
      </section>
    </div>
  );
}
