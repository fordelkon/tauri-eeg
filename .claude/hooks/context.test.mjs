import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('context.mjs', import.meta.url));
const guide = 'docs/verification.md';
const sentinel = 'fixture-only verification guidance';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'eeg-hook-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = path.join(base, 'checkout with spaces');
  const hook = path.join(repo, '.claude/hooks/context.mjs');
  for (const dir of [
    path.dirname(hook),
    path.dirname(path.join(repo, guide)),
    path.join(repo, 'src/experiment'),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await copyFile(script, hook);
  await writeFile(path.join(repo, guide), sentinel);
  await writeFile(path.join(repo, 'src/experiment/preparation.ts'), '');

  function invoke(file, tool = 'Read', extra = {}) {
    const input = { cwd: repo, tool_name: tool, tool_input: { file_path: file }, ...extra };
    const { status, stdout, stderr, error } = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      cwd: base,
      env: { ...process.env, TMPDIR: base, TEMP: base, TMP: base },
    });
    if (error) throw error;
    assert.equal(status, 0, stderr);
    if (!stdout.trim()) return undefined;
    const result = JSON.parse(stdout);
    assert.deepEqual(Object.keys(result), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(result.hookSpecificOutput).sort(), [
      'additionalContext',
      'hookEventName',
    ]);
    assert.equal(result.hookSpecificOutput.hookEventName, 'PreToolUse');
    return result.hookSpecificOutput.additionalContext;
  }
  return { base, repo, invoke };
}

test('project settings call the bundled script and route only file tools', async () => {
  const settings = JSON.parse(await readFile(new URL('../settings.json', import.meta.url), 'utf8'));
  const [rule] = settings.hooks.PreToolUse;
  assert.equal(rule.matcher, 'Read|Edit|Write');
  assert.equal(rule.hooks[0].command, 'node');
  assert.deepEqual(rule.hooks[0].args, ['${CLAUDE_PROJECT_DIR}/.claude/hooks/context.mjs']);
});

test('reads a match, handles a relative edit from a subdirectory and a new nested write', async (t) => {
  const { repo, invoke } = await fixture(t);
  assert.equal(invoke('src/experiment/preparation.ts'), sentinel);
  assert.equal(
    invoke('preparation.ts', 'Edit', { cwd: path.join(repo, 'src/experiment') }),
    sentinel,
  );
  assert.equal(invoke('src-tauri/src/experiment/new_dir/new.rs', 'Write'), sentinel);
});

test('unrelated files, neighboring checkouts and shell calls receive no context', async (t) => {
  const { repo, invoke } = await fixture(t);
  assert.equal(invoke('src/auth/AuthContext.tsx'), undefined);
  assert.equal(invoke('../../README.md'), undefined);
  assert.equal(invoke(repo + '-copy/src/experiment/preparation.ts'), undefined);
  assert.equal(invoke('src/experiment/preparation.ts', 'Bash'), undefined);
});

test('a junction or symlink out of the repo is excluded even for a new file', async (t) => {
  const { base, repo, invoke } = await fixture(t);
  const outside = path.join(base, 'external');
  await mkdir(outside);
  await writeFile(path.join(outside, 'existing.ts'), '');
  await symlink(
    outside,
    path.join(repo, 'src/experiment/linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(invoke('src/experiment/linked/existing.ts'), undefined);
  assert.equal(invoke('src/experiment/linked/new.ts', 'Write'), undefined);
});

test('one copy per session and agent, and changed guidance is delivered again', async (t) => {
  const { repo, invoke } = await fixture(t);
  const run = (session, agent) =>
    invoke('src/experiment/preparation.ts', 'Read', { session_id: session, agent_id: agent });
  assert.equal(run('one'), sentinel);
  assert.equal(run('one'), undefined);
  assert.equal(run('two'), sentinel);
  assert.equal(run('one', 'child'), sentinel);
  await writeFile(path.join(repo, guide), 'updated guide');
  assert.equal(run('one'), 'updated guide');
});
