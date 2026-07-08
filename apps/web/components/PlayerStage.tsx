'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Artplayer from 'artplayer';

const AUTO_NEXT_STORAGE_KEY = 'autoNextEpisode';

function getAutoNextPref(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
}

function setAutoNextPref(value: boolean): void {
  window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(value));
}

interface PlayerStageProps {
  coverUrl: string | null;
  playbackUrl: string | null;
  locked: boolean;
  onRequestPlay: () => void;
  onRequestLogin: () => void;
  onEnded: () => void;
}

export default function PlayerStage({
  coverUrl,
  playbackUrl,
  locked,
  onRequestPlay,
  onRequestLogin,
  onEnded,
}: PlayerStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!playbackUrl || !containerRef.current) {
      return;
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: playbackUrl,
      poster: coverUrl ?? '',
      autoplay: true,
      autoSize: false,
      fullscreen: true,
      setting: true,
      settings: [
        {
          name: 'autoNext',
          html: '自动连播',
          switch: getAutoNextPref(),
          onSwitch(item) {
            const next = !item.switch;
            setAutoNextPref(next);
            item.switch = next;
            return next;
          },
        },
      ],
    });

    art.on('video:ended', () => {
      if (getAutoNextPref()) {
        onEndedRef.current();
      }
    });

    return () => {
      art.destroy(false);
    };
  }, [coverUrl, playbackUrl]);

  if (playbackUrl) {
    return <div className="player-stage" ref={containerRef} />;
  }

  return (
    <div className="player-stage">
      <div
        className="player-placeholder"
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      >
        {locked ? (
          <div className="unlock-card">
            <div>
              <strong>这一集需要解锁</strong>
              <span>登录后可解锁全集或开通会员观看。</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="secondary-btn" onClick={onRequestLogin}>
                LINE 登录
              </button>
              <Link href="/membership" className="vip-btn">
                去解锁
              </Link>
            </div>
          </div>
        ) : (
          <button className="player-play-trigger" onClick={onRequestPlay} aria-label="播放第一集">
            <span className="player-big-play" aria-hidden="true">
              ▶
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
