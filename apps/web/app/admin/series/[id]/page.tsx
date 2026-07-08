'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface SeriesDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  status: string;
  updateStatus: string;
  freeEpisodeCount: number;
  unlockPriceCents: number;
  sortOrder: number;
  lastPublishedEpisodeAt: string | null;
}

interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  status: string;
  uploadError: string | null;
  r2Key?: string | null;
  replacementR2Key?: string | null;
  replacementStatus?: string | null;
  replacementUploadError?: string | null;
}

interface PublishCheckItem {
  code: string;
  message: string;
}

interface AuditLog {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  admin?: { username: string };
}

interface SeriesDetailResponse {
  series?: SeriesDetail;
  recentLogs?: AuditLog[];
}

interface PublishChecks {
  blockers: PublishCheckItem[];
  warnings: PublishCheckItem[];
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
  processing: '转码中',
  failed: '失败',
  offline: '已下架',
};

const UPDATE_STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
  paused: '暂停更新',
};

const REPLACEMENT_STATUS_LABEL: Record<string, string> = {
  processing: '替换转码中',
  ready: '替换待确认',
  failed: '替换失败',
};

const ACTION_LABEL: Record<string, string> = {
  'series.publish': '上架剧集',
  'series.offline': '下架剧集',
  'episode.publish': '上架集数',
  'episode.offline': '下架集数',
  'episode.replacement_start': '上传替换视频',
  'episode.replacement_confirm': '确认替换视频',
  'episode.replacement_abandon': '放弃替换视频',
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
  not_found: '资源不存在',
  video_not_uploaded: '视频还未转码完成',
  publish_blocked: '发布检查未通过',
  not_published: '仅已上架集数可替换视频',
  replacement_not_ready: '替换视频尚未准备好',
};

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; blockers?: PublishCheckItem[] };
    if (body.error === 'publish_blocked' && body.blockers?.length) {
      return body.blockers.map((item) => item.message).join('；');
    }
    if (body.error) return ERROR_LABEL[body.error] ?? body.error;
  } catch {
    // Non-JSON errors still get a concise user-facing fallback.
  }
  return fallback;
}

function formatPrice(cents: number) {
  return `NT$${(cents / 100).toFixed(0)}`;
}

function formatLogMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return '';
  const value = metadata as { episodeNumber?: unknown };
  return typeof value.episodeNumber === 'number' ? `第 ${value.episodeNumber} 集` : '';
}

export default function AdminSeriesEpisodesPage() {
  const params = useParams<{ id: string }>();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [publishChecks, setPublishChecks] = useState<PublishChecks>({ blockers: [], warnings: [] });
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
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
      const [detailRes, episodesRes, checksRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/series/${params.id}`, { headers: authJsonHeaders() }),
        fetch(`${API_BASE_URL}/api/admin/series/${params.id}/episodes`, { headers: authJsonHeaders() }),
        fetch(`${API_BASE_URL}/api/admin/series/${params.id}/publish-checks`, { headers: authJsonHeaders() }),
      ]);

      if (!detailRes.ok || !episodesRes.ok || !checksRes.ok) {
        setListError('工作台加载失败');
        return;
      }

      const detail = (await detailRes.json()) as SeriesDetailResponse;
      const episodeData = (await episodesRes.json()) as unknown;
      const checks = (await checksRes.json()) as PublishChecks;

      setSeries(detail.series ?? null);
      setRecentLogs(detail.recentLogs ?? []);
      setEpisodes(Array.isArray(episodeData) ? (episodeData as Episode[]) : []);
      setPublishChecks({
        blockers: Array.isArray(checks.blockers) ? checks.blockers : [],
        warnings: Array.isArray(checks.warnings) ? checks.warnings : [],
      });
      setListError('');
    } catch {
      setListError('工作台加载失败');
    }
  }, [params.id]);

  const nextEpisodeNumber = useMemo(() => {
    if (episodes.length === 0) return 1;
    return Math.max(...episodes.map((episode) => episode.episodeNumber)) + 1;
  }, [episodes]);

  const hasProcessing = useMemo(
    () => episodes.some((ep) => ep.status === 'processing' || ep.replacementStatus === 'processing'),
    [episodes]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (episodeNumber || episodes.length === 0) return;
    setEpisodeNumber(String(nextEpisodeNumber));
  }, [episodeNumber, episodes.length, nextEpisodeNumber]);

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, load]);

  async function publishSeries() {
    setActionError('');
    setPendingActionId('series-publish');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/publish`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '上架剧集失败'));
        return;
      }
      await load();
    } catch {
      setActionError('上架剧集失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function offlineSeries() {
    if (!confirm('确定下架整部剧？前台将不再显示。')) return;
    setActionError('');
    setPendingActionId('series-offline');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/series/${params.id}/offline`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '下架剧集失败'));
        return;
      }
      await load();
    } catch {
      setActionError('下架剧集失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function publish(id: string) {
    setActionError('');
    setPendingActionId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/publish`, {
        method: 'POST',
        headers: authJsonHeaders(),
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

  async function offlineEpisode(id: string) {
    if (!confirm('确定下架这一集？前台将不再显示。')) return;
    setActionError('');
    setPendingActionId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/offline`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '下架失败'));
        return;
      }
      await load();
    } catch {
      setActionError('下架失败');
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

  async function uploadReplacement(id: string, selected: File) {
    setActionError('');
    setPendingActionId(`replacement-upload-${id}`);
    try {
      const form = new FormData();
      form.append('video', selected);

      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/upload`, {
        method: 'POST',
        headers: authOnlyHeaders(),
        body: form,
      });
      if (!res.ok) {
        setActionError(await responseError(res, '替换上传失败'));
        return;
      }
      await load();
    } catch {
      setActionError('替换上传失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function previewReplacement(id: string) {
    setActionError('');
    setPendingActionId(`replacement-preview-${id}`);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/preview`, {
        headers: authJsonHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '预览替换视频失败'));
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('预览替换视频失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function confirmReplacement(id: string) {
    if (!confirm('确认用新视频替换当前线上视频？')) return;
    setActionError('');
    setPendingActionId(`replacement-confirm-${id}`);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/confirm`, {
        method: 'POST',
        headers: authOnlyHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '确认替换失败'));
        return;
      }
      await load();
    } catch {
      setActionError('确认替换失败');
    } finally {
      setPendingActionId(null);
    }
  }

  async function abandonReplacement(id: string) {
    if (!confirm('确定放弃这个替换视频？')) return;
    setActionError('');
    setPendingActionId(`replacement-abandon-${id}`);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/episodes/${id}/replacement/abandon`, {
        method: 'POST',
        headers: authOnlyHeaders(),
      });
      if (!res.ok) {
        setActionError(await responseError(res, '放弃替换失败'));
        return;
      }
      await load();
    } catch {
      setActionError('放弃替换失败');
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

      setEpisodeNumber(String(nextEpisodeNumber + 1));
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
            <h1>运营工作台</h1>
            <p>稳定发布整部剧、追加新集、替换已上线视频，并保留关键操作记录。</p>
          </div>
          <div className="admin-actions">
            <Link href="/admin" className="admin-btn">
              返回剧集列表
            </Link>
            {series?.status === 'published' && (
              <Link href={`/series/${series.id}`} className="admin-btn">
                查看前台
              </Link>
            )}
          </div>
        </header>

        {(listError || actionError) && (
          <div style={{ marginBottom: 16 }}>
            {listError && <p className="error-text">{listError}</p>}
            {actionError && <p className="error-text">{actionError}</p>}
          </div>
        )}

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>基础信息</h2>
              <p>
                {series
                  ? `${STATUS_LABEL[series.status] ?? series.status} / ${
                      UPDATE_STATUS_LABEL[series.updateStatus] ?? series.updateStatus
                    }`
                  : '加载中'}
              </p>
            </div>
            <div className="admin-actions">
              {series?.status !== 'published' && (
                <button className="admin-btn admin-primary" disabled={pendingActionId === 'series-publish'} onClick={publishSeries}>
                  {pendingActionId === 'series-publish' ? '上架中…' : '上架剧集'}
                </button>
              )}
              {series?.status === 'published' && (
                <button className="admin-btn" disabled={pendingActionId === 'series-offline'} onClick={offlineSeries}>
                  {pendingActionId === 'series-offline' ? '下架中…' : '下架剧集'}
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, padding: 16 }}>
            <strong>{series?.title ?? '剧集加载中'}</strong>
            <p className="view-status" style={{ whiteSpace: 'normal', lineHeight: 1.6 }}>
              {series?.description || '暂未填写简介'}
            </p>
            <div className="admin-actions">
              <span className={`status ${series?.status ?? 'draft'}`}>{series ? STATUS_LABEL[series.status] ?? series.status : '加载中'}</span>
              <span className="status draft">{series ? UPDATE_STATUS_LABEL[series.updateStatus] ?? series.updateStatus : '更新状态'}</span>
              <span className="status published">
                {series?.unlockPriceCents === 0 ? '免费观看' : `试看 ${series?.freeEpisodeCount ?? 0} 集 / ${formatPrice(series?.unlockPriceCents ?? 0)}`}
              </span>
              <span className="view-status">
                最近更新：{series?.lastPublishedEpisodeAt ? new Date(series.lastPublishedEpisodeAt).toLocaleString() : '暂无'}
              </span>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>发布检查</h2>
              <p>硬问题会阻止上架，提醒项用于发布前人工确认。</p>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8, padding: 16 }}>
            {publishChecks.blockers.map((item) => (
              <p className="error-text" key={item.code}>
                {item.message}
              </p>
            ))}
            {publishChecks.warnings.map((item) => (
              <p className="view-status" key={item.code} style={{ whiteSpace: 'normal' }}>
                {item.message}
              </p>
            ))}
            {publishChecks.blockers.length === 0 && publishChecks.warnings.length === 0 && <p className="view-status">检查通过</p>}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>上传新集数</h2>
              <p>新集上传后进入转码队列，完成后保持草稿，由管理员手动上架。</p>
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
              <p className="view-status">建议下一集：第 {nextEpisodeNumber} 集</p>
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
              <p>新集、下架、重试和已上线视频替换都在这里处理。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>集数</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>替换视频</th>
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
                      <div style={{ display: 'grid', gap: 8, minWidth: 180 }}>
                        {ep.replacementStatus ? (
                          <span className={`status ${ep.replacementStatus === 'failed' ? 'failed' : 'processing'}`}>
                            {REPLACEMENT_STATUS_LABEL[ep.replacementStatus] ?? ep.replacementStatus}
                          </span>
                        ) : (
                          <span className="view-status">暂无替换</span>
                        )}
                        {ep.replacementUploadError && (
                          <p className="error-text" style={{ maxWidth: 260, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            {ep.replacementUploadError}
                          </p>
                        )}
                        {ep.status === 'published' && (
                          <input
                            type="file"
                            accept="video/*"
                            disabled={pendingActionId === `replacement-upload-${ep.id}`}
                            onChange={(e) => {
                              const selected = e.target.files?.[0];
                              if (selected) void uploadReplacement(ep.id, selected);
                              e.currentTarget.value = '';
                            }}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ep.status === 'draft' && (
                          <button className="admin-btn" disabled={pendingActionId === ep.id} onClick={() => publish(ep.id)}>
                            {pendingActionId === ep.id ? '上架中…' : '上架'}
                          </button>
                        )}
                        {ep.status === 'published' && (
                          <button className="admin-btn" disabled={pendingActionId === ep.id} onClick={() => offlineEpisode(ep.id)}>
                            {pendingActionId === ep.id ? '下架中…' : '下架'}
                          </button>
                        )}
                        {ep.status === 'failed' && (
                          <button className="admin-btn" disabled={pendingActionId === ep.id} onClick={() => retry(ep.id)}>
                            {pendingActionId === ep.id ? '重试中…' : '重试'}
                          </button>
                        )}
                        {ep.replacementStatus === 'ready' && (
                          <>
                            <button
                              className="admin-btn"
                              disabled={pendingActionId === `replacement-preview-${ep.id}`}
                              onClick={() => previewReplacement(ep.id)}
                            >
                              预览替换
                            </button>
                            <button
                              className="admin-btn admin-primary"
                              disabled={pendingActionId === `replacement-confirm-${ep.id}`}
                              onClick={() => confirmReplacement(ep.id)}
                            >
                              确认替换
                            </button>
                            <button
                              className="admin-btn"
                              disabled={pendingActionId === `replacement-abandon-${ep.id}`}
                              onClick={() => abandonReplacement(ep.id)}
                            >
                              放弃替换
                            </button>
                          </>
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
              <h2>最近操作</h2>
              <p>记录影响前台展示、收费或观看的关键动作。</p>
            </div>
          </div>
          <ul style={{ display: 'grid', gap: 10, margin: 0, padding: 16 }}>
            {recentLogs.map((log) => (
              <li key={log.id}>
                <strong>{ACTION_LABEL[log.action] ?? log.action}</strong>
                <span className="view-status" style={{ marginLeft: 8 }}>
                  {formatLogMetadata(log.metadata)}
                  {formatLogMetadata(log.metadata) ? ' · ' : ''}
                  {log.admin?.username ?? 'admin'} · {new Date(log.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
            {recentLogs.length === 0 && <li className="view-status">暂无操作记录</li>}
          </ul>
        </article>
      </main>
    </div>
  );
}
