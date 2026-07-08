'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Series {
  id: string;
  title: string;
  status: string;
  updateStatus: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
  sortOrder: number;
  lastPublishedEpisodeAt: string | null;
}

function authHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

const STATUS_LABEL: Record<string, string> = {
  published: '已上架',
  draft: '草稿',
  offline: '已下架',
};

const UPDATE_STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
  paused: '暂停更新',
};

export default function AdminDashboardPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [title, setTitle] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState('');
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantSeriesId, setGrantSeriesId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [updateStatusFilter, setUpdateStatusFilter] = useState('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const creatingRef = useRef(false);

  async function loadSeries() {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (updateStatusFilter !== 'all') params.set('updateStatus', updateStatusFilter);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE_URL}/api/admin/series${suffix}`, { headers: authHeaders() });
      if (!res.ok) {
        setListError('剧集列表加载失败，请重新登录后再试');
        return;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        setListError('剧集列表加载失败，请稍后重试');
        return;
      }

      setSeriesList(data);
      setListError('');
    } catch {
      setListError('剧集列表加载失败，请稍后重试');
    }
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
    setActionError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/series/${id}/publish`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        setActionError('上架失败，请稍后重试');
        return;
      }
      await loadSeries();
    } catch {
      setActionError('上架失败，请稍后重试');
    }
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
  const offlineCount = seriesList.filter((s) => s.status === 'offline').length;
  const draftCount = seriesList.filter((s) => s.status === 'draft').length;

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
          <article className="stat-card">
            <span>已下架</span>
            <strong>{offlineCount}</strong>
          </article>
        </section>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>剧集列表</h2>
              <p>剧名、状态、更新进度、免费集数、解锁价格。</p>
            </div>
          </div>
          <div className="admin-actions" style={{ padding: '0 16px 16px' }}>
            <input placeholder="搜索剧名" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="published">已上架</option>
              <option value="offline">已下架</option>
            </select>
            <select value={updateStatusFilter} onChange={(e) => setUpdateStatusFilter(e.target.value)}>
              <option value="all">全部更新</option>
              <option value="ongoing">连载中</option>
              <option value="completed">已完结</option>
              <option value="paused">暂停更新</option>
            </select>
            <button className="admin-btn" onClick={loadSeries}>
              筛选
            </button>
          </div>
          {(listError || actionError) && (
            <div style={{ padding: '0 16px 12px' }}>
              {listError && <p className="error-text">{listError}</p>}
              {actionError && <p className="error-text">{actionError}</p>}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>剧名</th>
                  <th>状态</th>
                  <th>更新</th>
                  <th>免费集数</th>
                  <th>解锁价格</th>
                  <th>最近更新</th>
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
                      <span className={`status ${s.status}`}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                    <td>{UPDATE_STATUS_LABEL[s.updateStatus] ?? s.updateStatus}</td>
                    <td>{s.freeEpisodeCount}</td>
                    <td>{s.unlockPriceCents === 0 ? '免费观看' : `NT$${(s.unlockPriceCents / 100).toFixed(0)}`}</td>
                    <td>{s.lastPublishedEpisodeAt ? new Date(s.lastPublishedEpisodeAt).toLocaleDateString() : '尚未更新'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <Link href={`/admin/series/${s.id}`} className="admin-btn">
                          运营工作台
                        </Link>
                        {s.status !== 'published' && (
                          <button className="admin-btn" onClick={() => publishSeries(s.id)}>
                            上架
                          </button>
                        )}
                      </div>
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
