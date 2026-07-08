import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/video.mp4'),
}));

import { getPlaybackUrl, uploadEpisodeVideo } from '../src/lib/r2.js';

describe('getPlaybackUrl', () => {
  it('returns a signed url for the given key', async () => {
    const url = await getPlaybackUrl('series/1/episode-1.mp4');
    expect(url).toBe('https://signed.example.com/video.mp4');
  });
});

describe('uploadEpisodeVideo', () => {
  it('streams the file to R2 instead of buffering the whole video', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({});
    const dir = await mkdtemp(path.join(tmpdir(), 'short-drama-r2-'));
    const filePath = path.join(dir, 'episode.mp4');
    await writeFile(filePath, Buffer.from('video-bytes'));

    try {
      await uploadEpisodeVideo('series/1/episode-1.mp4', filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: process.env.R2_BUCKET ?? '',
      Key: 'series/1/episode-1.mp4',
      ContentType: 'video/mp4',
      ContentLength: 11,
    });
    expect(typeof command.input.Body?.pipe).toBe('function');
  });
});
