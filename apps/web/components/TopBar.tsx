'use client';

import Link from 'next/link';
import { useState } from 'react';

interface TopBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export default function TopBar({ searchValue, onSearchChange }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="短剧馆首页">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M8.2 5.4v13.2L18.6 12 8.2 5.4Z" fill="currentColor" />
          </svg>
        </span>
        <span>短剧馆</span>
      </Link>

      {onSearchChange ? (
        <label className="search-inline">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="搜索短剧"
            aria-label="搜索短剧"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
      ) : (
        <span />
      )}

      <div className="top-actions">
        <button className="avatar-btn" onClick={() => setMenuOpen((open) => !open)} aria-label="打开用户菜单">
          我
        </button>
      </div>

      <aside className={`user-menu ${menuOpen ? 'is-open' : ''}`} aria-label="用户菜单">
        <div className="menu-list">
          <Link href="/membership" onClick={() => setMenuOpen(false)}>
            会员中心 <span>›</span>
          </Link>
          <Link href="/admin/login" onClick={() => setMenuOpen(false)}>
            管理员登录 <span>›</span>
          </Link>
        </div>
      </aside>
    </header>
  );
}
