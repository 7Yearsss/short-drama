'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  status: string;
  uploadError: string | null;
}

function authJsonHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function authOnlyHeaders() {
  const token = localStorage.getItem('sd_admin_token');
  return { Authorization: `Bearer ${token}` };
}

const STATUS_LABEL: Record<string, string> = {
  published: '已上架',
  draft: '草稿',
  processing: '转码中…',
  failed: '失败',
};

const ERROR_LABEL: Record<string, string> = {
  episode_number_taken: '集数已存在',
  invalid_video: '请选择有效视频',
  missing_video: '请选择视频文件',
  missing_fields: '请填写完整信息',
  series_not_found: '剧集不存在',
  upload_enqueue_failed: '转码排队失败，请重试',
  upload_failed: '上传失败，请重试',
  not_failed: '当前集数不能重试',
  no_retained_file: '原始文件已丢失，请重新上传',
  not_found: '集数不存在',
};

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return ERROR_LABEL[body.error] ?? body.error;
  } catch {
    // Non-JSON errors still get a concise user-facing fallback.
  }
  return fallback;
}

export default function AdminSeriesEpisodesPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [listError, setListError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/episodes`, { headers: authJsonHeaders() });
      if (!res.ok) {
        setListError(await responseError(res, '集数加载失败'));
        return;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        setListError('集数加载失败');
        return;
      }

      setEpisodes(data);
      setListError('');
    } catch {
      setListError('集数加载失败');
    }
  }, [params.id]);

  const hasProcessing = useMemo(() => episodes.some((ep) => ep.status === 'processing'), [episodes]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, load]);

  async function publish(id: string) {
    setActionError('');
    setPendingActionId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}`, {
        method: 'PATCH',
        headers: authJsonHeaders(),
        body: JSON.stringify({ status: 'published' }),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '上架失败'));
        return;
      }
      await load();
    } catch {
      setActionError('上架失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function retry(id: string) {
    setActionError('');
    setPendingActionId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/retry`, {
        method: 'POST',
        headers: authOnlyHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '重试失败'));
        return;
      }
      await load();
    } catch {
      setActionError('重试失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setUploadError('');
    if (!file) {
      setUploadError('请选择视频文件');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('seriesId', params.id);
      form.append('episodeNumber', episodeNumber);
      form.append('title', title);
      form.append('video', file);

      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/upload`, {
        method: 'POST',
        headers: authOnlyHeaders(),
        body: form,
      });
      if (!res.ok) {
        setUploadError(await responseError(res, '上传失败'));
        return;
      }

      setEpisodeNumber('');
      setTitle('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch {
      setUploadError('上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="admin-shell">
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-title">
            <h1>集数管理</h1>
            <p>选择视频文件上传，服务端自动转码并发布到 R2。</p>
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
              <h2>上传新集数</h2>
              <p>选择集数、标题和视频文件，上传后进入转码队列。</p>
            </div>
          </div>
          <form className="form-grid" style={{ padding: 16 }} onSubmit={upload}>
            <div className="field">
              <label htmlFor="episodeNumber">集数</label>
              <input
                id="episodeNumber"
                type="number"
                min="1"
                required
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="episodeTitle">标题</label>
              <input id="episodeTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="videoFile">视频文件</label>
              <input
                ref={fileInputRef}
                id="videoFile"
                type="file"
                accept="video/*"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {uploadError && <p className="error-text">{uploadError}</p>}
            <button className="admin-btn admin-primary" type="submit" disabled={uploading}>
              {uploading ? '上传中…' : '上传'}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>集数列表</h2>
              <p>集数、标题、状态与上架操作。</p>
            </div>
          </div>
          {(listError || actionError) && (
            <div style={{ padding: '12px 16px 0' }}>
              {listError && <p className="error-text">{listError}</p>}
              {actionError && <p className="error-text">{actionError}</p>}
            </div>
          )}
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
                      <span className={`status ${ep.status}`}>{STATUS_LABEL[ep.status] ?? ep.status}</span>
                      {ep.status === 'failed' && ep.uploadError && (
                        <div
                          className="view-status"
                          style={{ marginTop: 6, maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-word' }}
                        >
                          {ep.uploadError}
                        </div>
                      )}
                    </td>
                    <td>
                      {ep.status === 'draft' && (
                        <button className="admin-btn" disabled={pendingActionId === ep.id} onClick={() => publish(ep.id)}>
                          {pendingActionId === ep.id ? '上架中…' : '上架'}
                        </button>
                      )}
                      {ep.status === 'failed' && (
                        <button className="admin-btn" disabled={pendingActionId === ep.id} onClick={() => retry(ep.id)}>
                          {pendingActionId === ep.id ? '重试中…' : '重试'}
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
