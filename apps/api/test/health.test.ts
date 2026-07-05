import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('includes CORS headers on the response', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://example.com' } });
    expect(res.headers['access-control-allow-origin']).toBeDefined();
    await app.close();
  });
});
