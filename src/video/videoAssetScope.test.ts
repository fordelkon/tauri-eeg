import { describe, expect, it } from 'vitest';
import { videoAssetProtocolScopes } from './videoAssetScope';

describe('video asset protocol scope', () => {
  it('allows the spider YouTube video library through Tauri asset protocol', () => {
    expect(videoAssetProtocolScopes).toContain('D:\\spider_youtube\\mp4_videos\\video_library\\**');
    expect(videoAssetProtocolScopes).not.toContain('C:\\mp4_videos\\**');
  });
});
