# Experiment execution ownership

The UI presents stimuli and forwards operator and media events. Execution modules own phase permissions, pending operations, marker completion, and interruption. The Rust experiment worker remains authoritative for run exclusivity, lifecycle markers, serial writes, and persisted events.

## Effect evaluation

`src/pages/home/effectEvaluationExecution.ts` owns the complete evaluation run. Its snapshot provides the current phase, errors, pending scale/start operations, and the elapsed-window fact.

The module keeps duplicate marker callers waiting on the same delivery result. It sends markers in order and captures the frontend timestamp when the callback arrives. Normal condition completion requires the configured duration to elapse on the monotonic clock. A confirmed early exit records the existing skip marker before moving to post measurement.

Playback callbacks bind to a reset generation. A late callback from a retired player cannot change the next run. Reloading an unfinished persisted run interrupts it without replaying its markers.

`useEffectEvaluationFlow.ts` supplies storage, authentication, clock, IPC, scale, material, and report dependencies. It subscribes to execution state. `EffectEvaluation.tsx` keeps dialogs, focus, layout, and presentation.

## Paradigm trials

`src/paradigm/paradigmExecution.ts` owns the phase reducer, current operation, block gates, skip and abort coordination, and whole-run completion. Media callbacks carry the phase and trial index from their rendered state. The module rejects callbacks that no longer match the active trial.

`ParadigmExperiment` keeps trial snapshots, marker identities, persistence, and summaries. Stopping execution prevents subsequent markers and waits for the current mutation before saving an interrupted trial and closing the run.

`useIndependentParadigmRun.ts` subscribes to the execution snapshot and forwards UI facts. `ParadigmRunner.tsx` retains fullscreen handling, early-exit confirmation, global activity publication, and presentation. Returning to setup uses `exitSession()`; callers cannot dispatch arbitrary reducer actions.

## Material loading

`src/paradigm/materialLibraryLoader.ts` owns one caller's directory-loading lifecycle. Its state is idle, loading, ready, invalid, or failed. Each request has a generation. Late results from a superseded or cancelled request cannot replace the current directory state.

`useMaterialLibrary.ts` connects the loader to React. The induction pool, Calm regulation pool, and paradigm setup use the same lifecycle implementation. Emotion selection and deterministic queue preview remain with their callers. There is no shared cache or additional production scanner adapter.

## Effect reports

`src/pages/home/effectResultReports.ts` owns summary and condition-comparison requests for one frozen measurement context. Each report has an idle, loading, ready, or failed state. Reset, disposal, and retries invalidate earlier requests, so late successes and failures cannot replace current results or end a newer request's loading state.

`useEffectResultReports.ts` subscribes to the report module and maps its states to presentation values. It creates a new report context when the run, user, subject, emotion, or measurement IDs change, and starts loading only on the result step. Leaving that step disposes the context. Setup after cleanup starts fresh requests, including React's development lifecycle check.

## Experiment records

`src-tauri/src/experiment/records.rs` owns trial, scale, and BDF record validation and persistence, plus run lists and details. Trial IDs belong to one run. Scale links must match the run's frozen subject, operator, emotion, condition, and measurement phase; identical links are idempotent. Closed runs reject trial and scale writes. BDF association requires the run to have stopped.

The Tauri adapter forwards record operations through the existing worker queue. The worker's database is private. Reads and export manifests use the same queue; file export happens after the manifest returns. Tests cross the same worker record interface with a real in-memory SQLite database.

## Verification

Behavior tests cross the execution and loading interfaces with simulated external dependencies.

- `tests/effect/effectEvaluationExecution.test.ts` covers normal marker order, pending duplicate callbacks, duration permission, scale writes, interruption, recovery, and retired playback callbacks.
- `tests/paradigm/paradigmExecution.test.ts` covers trial order and identities, SAM quality, blocks, stale callbacks, competing end/skip operations, pending-operation aborts, and completion failures.
- `tests/paradigm/materialLibraryLoader.test.ts` covers directory replacement, stale results, invalid scans, failures, cancellation, and retained completed material.
- `tests/effect/effectResultReports.test.ts` covers missing measurements, reset, out-of-order retries, independent report failures, disposal, and setup after cleanup.
- `src-tauri/src/experiment/records_tests.rs` covers trial ownership, closed-run rejection, scale metadata and idempotence, BDF association, and record read contracts.
- `tests/biosemi-ui-smoke.cjs` checks experiment preparation at small and wide sizes, mode prerequisites, destination selection, effect setup, the empty-pool gate, and reset in the actual browser UI.

Run the test suite with `npm test` and the production build with `npm run build`. The browser smoke script requires Playwright and a running preview. Set `BIOSEMI_SMOKE_URL` to the preview origin, then run `node tests/biosemi-ui-smoke.cjs`.

On 2026-10-09, all 65 frontend test files and 455 tests passed, along with 118 Rust library tests, the production build, and the browser smoke checks. Browser checks simulate IPC and never send hardware pulses. These checks do not verify physical stimulus timing or trigger receipt in BDF files.
