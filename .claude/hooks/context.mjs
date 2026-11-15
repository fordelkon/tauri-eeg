import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const guide = 'docs/verification.md';

// Work with the real path, including when Write is about to create the file.
// A dangling link has a directory entry but no resolvable target. Skip it.
async function resolveTarget(target) {
  try {
    return await realpath(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await lstat(target);
      return null;
    } catch (entryError) {
      if (entryError.code !== 'ENOENT') throw entryError;
    }
    const parent = path.dirname(target);
    if (parent === target) return null;
    const existing = await resolveTarget(parent);
    return existing && path.join(existing, path.basename(target));
  }
}

const domains = [
  'src/agent/',
  'src/experiment/',
  'src/mentalScale/',
  'src/paradigm/',
  'src-tauri/src/experiment/',
  'src-tauri/src/paradigm/',
  'src-tauri/src/scale_records/',
  'tests/effect/',
  'tests/paradigm/',
  'tests/video/',
];
const files = new Set([
  'src/video/paradigmRegulationCatalog.ts',
  'src-tauri/src/bdf_destination.rs',
  'src-tauri/src/effect_reports.rs',
  'tests/biosemi-ui-smoke.cjs',
  'tests/experiment-archive-ui-smoke.cjs',
  'tests/inspect-bdf-triggers.cjs',
  'tests/rehearsal-assistant-smoke.cjs',
  'tests/stimulus-presentation-smoke.cjs',
  'tests/verify-bdf-reader.cjs',
  'tests/video-regulation-ui-smoke.cjs',
]);
const pagePrefix =
  /^src\/pages\/home\/(?:effect|experiment|preparation|evaluationCommands|useEffect|useInductionPlayback|videoRegulation)/i;

function matches(relative) {
  return (
    domains.some((prefix) => relative.startsWith(prefix)) ||
    files.has(relative) ||
    pagePrefix.test(relative)
  );
}

async function firstDelivery(input, content) {
  if (!input.session_id) return true;
  const digest = createHash('sha256')
    .update(JSON.stringify([root, input.session_id, input.agent_id, content]))
    .digest('hex');
  const dir = path.join(tmpdir(), 'tauri-eeg-context');
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, digest), '', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // Duplicate claims are expected. A read-only temp volume can still deliver guidance.
    return error.code !== 'EEXIST';
  }
  return true;
}

async function contextFor(input) {
  const target = input.tool_input?.file_path;
  if (!['Read', 'Edit', 'Write'].includes(input.tool_name) || typeof target !== 'string' || !target)
    return;
  const resolved = await resolveTarget(path.resolve(input.cwd || root, target));
  if (!resolved) return;
  const relative = path.relative(root, resolved).split(path.sep).join('/');
  if (!matches(relative)) return;
  const guidePath = await realpath(path.join(root, guide));
  const guideRelative = path.relative(root, guidePath);
  if (
    guideRelative === '..' ||
    guideRelative.startsWith('..' + path.sep) ||
    path.isAbsolute(guideRelative)
  )
    return;
  const content = await readFile(guidePath, 'utf8');
  if (await firstDelivery(input, content)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: content } };
  }
}

process.stdin.setEncoding('utf8');
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const result = await contextFor(JSON.parse(raw));
if (result) process.stdout.write(JSON.stringify(result) + '\n');
