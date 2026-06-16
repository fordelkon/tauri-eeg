import { describe, expect, it } from 'vitest';
import { videoAssetProtocolScopes } from './videoAssetScope';

describe('video asset protocol scope', () => {
  it('allows user selected video folders through Tauri asset protocol', () => {
    expect(videoAssetProtocolScopes).toContain('**');
    expect(videoAssetProtocolScopes).not.toContain('C:\\mp4_videos\\**');
  });
});
