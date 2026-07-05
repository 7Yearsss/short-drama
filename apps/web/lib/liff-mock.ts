'use client';

const TOKEN_KEY = 'sd_user_token';
const UID_KEY = 'sd_dev_line_uid';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

function getOrCreateDevLineUid(): string {
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export async function mockLineLogin(): Promise<string> {
  const lineUid = getOrCreateDevLineUid();
  const res = await fetch(`${API_BASE_URL}/api/auth/line`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUid, nickname: '测试用户' }),
  });
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}
