# 020 — Tighten Experiment Settings logic: dedupe the load, gate navigation while busy, shared error copy

- **Status**: DONE
- **Commit**: a09c7bf
- **Severity**: MEDIUM
- **Category**: Logic / correctness (user-requested alongside the UI pass)
- **Estimated scope**: 2 files (~35 lines)

## Problem

Three logic smells, all vetted at a09c7bf:

1. **Duplicated device load** — the initial fetch
   (`src/pages/home/ExperimentSettings.tsx:41-50`) re-implements `refresh()`
   (:36-40) with slightly different `setPort` semantics (initial load picks
   `nextStatus.portName || nextPorts[0]`; refresh prefers the current
   selection). Two code paths for one job will drift.

   ```tsx
   /* ExperimentSettings.tsx:36-50 — current */
   const refresh = async () => {
     const [nextStatus, nextPorts] = await Promise.all([getTriggerStatus(), listTriggerPorts()]);
     setStatus(nextStatus); setPorts(nextPorts);
     setPort((current) => current || nextStatus.portName || nextPorts[0]?.portName || '');
   };
   useEffect(() => {
     if (!desktop) return;
     let mounted = true;
     void Promise.all([getTriggerStatus(), listTriggerPorts()]).then(([nextStatus, nextPorts]) => {
       if (!mounted) return;
       setStatus(nextStatus); setPorts(nextPorts);
       setPort(nextStatus.portName || nextPorts[0]?.portName || '');
     }).catch((failure) => { if (mounted) setError(message(failure)); });
     return () => { mounted = false; };
   }, [desktop]);
   ```

2. **Stage navigation is not gated while an operation is in flight** — the
   下一步 button (`ExperimentSettings.tsx:137`) and the back button (:69) stay
   enabled during a serial write, so the operator can jump to the paradigm
   stage while `connectTrigger`/`testTrigger` is still resolving.

3. **Two error-formatting dialects** — `ExperimentSettings.tsx:17` defines a
   local `message()` helper, while `ExperimentRunHistory.tsx:25` uses raw
   `String(failure)` (raw English `Error: …` strings leak into the operator
   UI). The app already has the canonical degradation helper
   `describeFriendlyError` in `src/ui/friendlyError.ts:38` (logs the original
   to console, passes through already-Chinese backend text, degrades the
   rest).

## Target

1. `useEffect` calls `refresh()`; `refresh` becomes the single loader with a
   mounted guard:
   ```tsx
   /* target */
   const refresh = async () => {
     const [nextStatus, nextPorts] = await Promise.all([getTriggerStatus(), listTriggerPorts()]);
     setStatus(nextStatus); setPorts(nextPorts);
     setPort((current) => current || nextStatus.portName || nextPorts[0]?.portName || '');
   };
   useEffect(() => {
     if (!desktop) return;
     let mounted = true;
     const guard = <T,>(apply: (value: T) => void) => (value: T) => { if (mounted) apply(value); };
     void refresh().catch((failure) => { if (mounted) setError(describeFriendlyError(failure, '读取触发盒状态')); });
     return () => { mounted = false; };
   }, [desktop]);
   ```
   (If the `guard` helper proves unused, drop it — the minimal correct form is
   the effect body above without it.)
2. Both stage-navigation controls get `disabled={busy}`:
   - 下一步 button (`:137`): `disabled={busy}`.
   - back button (`:69`): `disabled={busy}`.
   Note: gate on `busy` only — NOT `locked`, because `status.activeRunId`
   being set must not block going TO the paradigm stage where the run lives.
3. Error copy: delete the local `message` const
   (`ExperimentSettings.tsx:17`) and replace every `message(failure)` with
   `describeFriendlyError(failure, '<context>')` where `<context>` names the
   action in Chinese — e.g. `'读取触发盒状态'`, `'连接触发盒'`, `'发送测试 Trigger'`,
   `'验证素材库'`, `'写入实验偏好'`. Same replacement in
   `ExperimentRunHistory.tsx` for `String(failure)` at :25 and :20
   (`describeFriendlyError(failure, '读取实验记录')`), adding
   `import { describeFriendlyError } from '../ui/friendlyError';`.

## Repo conventions to follow

- `describeFriendlyError(error, context)` contract is documented at
  `src/ui/friendlyError.ts:31-37`; see its existing callers for the
  `context` naming style (grep `describeFriendlyError(` under `src/`).
- Effects with async loads use the `mounted` flag pattern — keep it.

## Steps

1. **`src/pages/home/ExperimentSettings.tsx`** — apply Target item 1 (delete
   the duplicated `Promise.all` block inside `useEffect`; call `refresh()`).
2. **Same file** — apply Target item 2 (two `disabled={busy}` additions).
3. **Same file** — apply Target item 3: remove the local `message` helper and
   switch all call sites to `describeFriendlyError` with per-action context.
4. **`src/experiment/ExperimentRunHistory.tsx`** — replace `String(failure)`
   (line 25) and the `String(failure)` in the load effect (line 20) with
   `describeFriendlyError(failure, '读取实验记录')`, and add the import.
5. Run the checks in Verification.

## Boundaries

- Do NOT change persistence behavior (`savePreferences` writing on each
  change is intentional — operator state must survive a crash).
- Do NOT change the `locked` definition or which device buttons it disables.
- Do NOT add debouncing, polling, or new state machines.
- If `describeFriendlyError` has been renamed/removed since a09c7bf, STOP
  and report.

## Verification

- **Mechanical**: `pnpm vitest run` (full unit suite) passes;
  `npx tsc --noEmit` (or the repo's typecheck script) is clean.
- **Feel check**:
  - On page load with the device service running, ports populate exactly as
    before (refresh path unchanged).
  - Click 连接触发盒 and immediately click 下一步: the button is disabled
    until the connect resolves/fails.
  - Force a failure (test trigger with no device): the banner shows the
    friendly Chinese copy, and the original error appears in the console
    prefixed `[ui]`.
- **Done when**: one code path loads the device state, navigation cannot
  happen mid-operation, and no `String(failure)` or local `message()` helper
  remains in either file.
