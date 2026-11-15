// Explicit live check: two fresh Claude Code requests using the local account.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const temp = await realpath(os.tmpdir());
const fixture = await mkdtemp(path.join(temp, 'eeg-context-check-'));
const entry = 'docs/verification.md';
const canary = randomUUID();
const positive = 'src/experiment/preparation.ts';
const negative = 'src/auth/AuthContext.tsx';

async function put(name, content) {
  const filename = path.join(fixture, name);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

async function probe(file, expected) {
  const session = randomUUID();
  const prompt = `Use Read exactly once on ${file}. Do not read other files. Then return only the value after audit-token= in the additional project context from that read. If it contains no such value, return ABSENT.`;
  const args = ['--print', '--no-session-persistence', '--session-id', session,
    '--output-format', 'stream-json', '--verbose', '--strict-mcp-config',
    '--permission-mode', 'dontAsk', '--tools', 'Read', '--allowedTools', 'Read', '--', prompt];
  const command = process.env.CLAUDE_CLI || (process.platform === 'win32' ? 'claude.exe' : 'claude');
  const { stdout } = await exec(command, args, {
    cwd: fixture, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  const events = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const calls = events.filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message.content).filter((item) => item.type === 'tool_use');
  assert.equal(calls.length, 1, 'Expected exactly one tool call');
  assert.equal(calls[0].name, 'Read');
  assert.equal(path.resolve(fixture, calls[0].input.file_path), path.resolve(fixture, file));
  const readResult = events.filter((e) => e.type === 'user')
    .flatMap((e) => e.message.content)
    .find((item) => item.type === 'tool_result' && item.tool_use_id === calls[0].id);
  assert(readResult && !readResult.is_error, 'File read did not succeed');
  const result = events.find((e) => e.type === 'result');
  assert.equal(result?.is_error, false, 'Client did not complete');
  assert.equal(result.result.trim(), expected, 'Context did not match this route');
  console.log(`PASS ${file} (${expected === canary ? 'hook injected' : 'no token'}, fresh session ${session})`);
}

try {
  for (const name of ['.claude/settings.json', '.claude/hooks/context.mjs', entry]) {
    const content = await readFile(path.join(repo, name), 'utf8');
    await put(name, name === entry ? content + '\naudit-token=' + canary + '\n' : content);
  }
  for (const name of [positive, negative]) await put(name, 'export {};\n');
  await probe(positive, canary);
  await probe(negative, 'ABSENT');
} catch (error) {
  // Full stream output can contain host configuration. Only show diagnostic status.
  console.error(error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] :
    `Claude Code check failed (${error.code ?? error.name}, signal ${error.signal ?? 'none'}).`);
  if (error.stdout) {
    for (const line of error.stdout.trim().split(/\r?\n/)) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result') console.error('Client result:', event.subtype);
      } catch { /* Ignore non-JSON startup notices. */ }
    }
  }
  process.exitCode = 1;
} finally {
  const actual = await realpath(fixture);
  assert(path.dirname(actual) === temp && path.basename(actual).startsWith('eeg-context-check-'));
  await rm(actual, { recursive: true, force: true });
}
