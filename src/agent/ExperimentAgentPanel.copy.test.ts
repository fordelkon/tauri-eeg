// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('ExperimentAgentPanel copy', () => {
  test('localizes assistant panel display copy to Chinese', () => {
    const source = readFileSync(new URL('./ExperimentAgentPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('思考中');
    expect(source).toContain('已思考');
    expect(source).toContain('等待规划器响应。');
    expect(source).toContain('快捷指令示例');
    expect(source).toContain('规划器思考步骤');
    expect(source).toContain('最近助手记录');
    expect(source).toContain('实验助手聊天');
    expect(source).not.toContain('Thinking ');
    expect(source).not.toContain('Thought for');
    expect(source).not.toContain('Waiting for planner response.');
    expect(source).not.toContain('Prompt examples');
    expect(source).not.toContain('Planner thinking steps');
    expect(source).not.toContain('Recent assistant timeline');
  });
});
