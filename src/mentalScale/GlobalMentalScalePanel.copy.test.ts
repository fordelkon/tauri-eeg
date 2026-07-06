// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GlobalMentalScalePanel copy', () => {
  it('localizes the global mental scale panel display copy to Chinese', () => {
    const source = readFileSync(new URL('./GlobalMentalScalePanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('全局心理量表状态');
    expect(source).toContain('心理状态雷达图');
    expect(source).toContain('心理状态');
    expect(source).toContain('平均基线');
    expect(source).toContain('焦虑');
    expect(source).toContain('担忧');
    expect(source).toContain('情绪');
    expect(source).toContain('精力');
    expect(source).not.toContain('Global mental scale status');
    expect(source).not.toContain('Six dimension mental state radar chart');
    expect(source).not.toContain('Mental state');
  });
});
