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

## Verification

Behavior tests cross the execution and loading interfaces with simulated external dependencies.

- `tests/effect/effectEvaluationExecution.test.ts` covers normal marker order, pending duplicate callbacks, duration permission, scale writes, interruption, recovery, and retired playback callbacks.
- `tests/paradigm/paradigmExecution.test.ts` covers trial order and identities, SAM quality, blocks, stale callbacks, competing end/skip operations, pending-operation aborts, and completion failures.
- `tests/paradigm/materialLibraryLoader.test.ts` covers directory replacement, stale results, invalid scans, failures, cancellation, and retained completed material.
- `tests/biosemi-ui-smoke.cjs` checks experiment preparation at small and wide sizes, mode prerequisites, destination selection, effect setup, the empty-pool gate, and reset in the actual browser UI.

Run the test suite with `npm test` and the production build with `npm run build`. The browser smoke script requires Playwright and a running preview. Set `BIOSEMI_SMOKE_URL` to the preview origin, then run `node tests/biosemi-ui-smoke.cjs`.

On 2026-10-09, all 64 test files and 447 tests passed. The production build and browser smoke checks also passed. Browser checks simulate IPC and never send hardware pulses. These checks do not verify physical stimulus timing or trigger receipt in BDF files.
