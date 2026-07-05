'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError('登录失败');
      return;
    }
    const data = await res.json();
    localStorage.setItem('sd_admin_token', data.token);
    router.push('/admin');
  }

  return (
    <form onSubmit={submit} style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 320 }}>
      <h1>管理员登录</h1>
      <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit">登录</button>
    </form>
  );
}
