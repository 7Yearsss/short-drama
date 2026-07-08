import { describe, it, expect } from 'vitest';
import { buildCoverPublicUrl } from '../src/lib/covers-r2.js';

describe('buildCoverPublicUrl', () => {
  it('builds a cover URL without duplicating slashes', () => {
    expect(buildCoverPublicUrl('https://pub-example.r2.dev/', 'abc.jpg')).toBe('https://pub-example.r2.dev/abc.jpg');
  });

  it('fails clearly when the public URL is missing', () => {
    expect(() => buildCoverPublicUrl('', 'abc.jpg')).toThrow('R2_COVERS_PUBLIC_URL is required');
    expect(() => buildCoverPublicUrl('   ', 'abc.jpg')).toThrow('R2_COVERS_PUBLIC_URL is required');
  });
});
