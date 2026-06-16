import { describe, expect, it } from 'vitest';
import { videoAssetProtocolScopes } from './videoAssetScope';

describe('video asset protocol scope', () => {
  it('allows the seeded local video directory through Tauri asset protocol', () => {
    expect(videoAssetProtocolScopes).toContain('C:\\mp4_videos\\**');
  });
});
