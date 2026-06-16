# Native Storage Folder Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Home storage folder icon open the native directory picker and save the selected folder as the storage root.

**Architecture:** Add a small frontend helper that wraps Tauri dialog selection and the existing storage API, then call it from `Home.tsx`. Register the Tauri dialog plugin and grant the default dialog permission.

**Tech Stack:** React, TypeScript, Vitest, Tauri v2, Rust.

---

## Files

- Create `src/storage/storageDirectoryPicker.ts`: testable helper for opening a directory picker and saving the selected root.
- Create `src/storage/storageDirectoryPicker.test.ts`: mock-first tests for selected and cancelled directory picker behavior.
- Modify `src/pages/Home.tsx`: folder icon opens the picker and updates storage state.
- Modify `package.json` / `pnpm-lock.yaml`: add `@tauri-apps/plugin-dialog`.
- Modify `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`: add `tauri-plugin-dialog`.
- Modify `src-tauri/src/lib.rs`: register the dialog plugin.
- Modify `src-tauri/capabilities/default.json`: grant dialog permission.

## Tasks

- [ ] Add failing Vitest coverage for choosing a storage directory.
- [ ] Implement the frontend helper using `open({ directory: true, multiple: false })`.
- [ ] Wire `Home.tsx` folder icon to invoke the helper and keep manual input as fallback.
- [ ] Add Tauri dialog frontend/Rust dependencies and capability permission.
- [ ] Run `pnpm test`, `pnpm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
