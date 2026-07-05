import { describe, it, expect, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4'),
}));

import { getPlaybackUrl } from '../src/lib/r2.js';

describe('getPlaybackUrl', () => {
  it('returns a signed url for the given key', async () => {
    const url = await getPlaybackUrl('series/1/episode-1.mp4');
    expect(url).toBe('https://signed.example.com/video.mp4');
  });
});
