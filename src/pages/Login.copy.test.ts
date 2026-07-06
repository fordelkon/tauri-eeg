// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Login copy', () => {
  it('localizes the right panel authentication copy to Chinese', () => {
    const source = readFileSync(new URL('./Login.tsx', import.meta.url), 'utf8');

    expect(source).toContain('登录后继续实验');
    expect(source).toContain('EEG Ecosystem');
    expect(source).toContain('创建账号');
    expect(source).toContain('重置密码');
    expect(source).toContain('请输入账号');
    expect(source).toContain('请输入邮箱');
    expect(source).toContain('还没有账号？立即注册');
    expect(source).toContain('忘记密码？');
    expect(source).not.toContain('Sign in to continue.');
    expect(source).not.toContain('Create your account.');
    expect(source).not.toContain('Forgotten your password?');
  });
});
