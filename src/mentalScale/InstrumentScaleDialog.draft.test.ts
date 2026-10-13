// @ts-expect-error test-only imports
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import type * as ReactDOM from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material', () => ({
  Alert: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'alert' }, children),
  Button: ({
    children,
    onClick,
    color,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    color?: string;
  }) => createElement('button', { onClick, 'data-color': color }, children),
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement('h2', null, children),
  DialogContent: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  DialogContentText: ({ children }: { children?: ReactNode }) => createElement('p', null, children),
  DialogActions: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  IconButton: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
    createElement('button', { onClick }, children),
}));

vi.mock('@mui/material/Alert', () => ({
  default: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'alert' }, children),
}));

vi.mock('@mui/icons-material/CloseRounded', () => ({
  default: () => createElement('span', null, 'x'),
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof ReactDOM>('react-dom');
  return {
    ...actual,
    createPortal: (node: ReactNode) => node,
  };
});

import {
  clearInstrumentScaleDraft,
  getInstrumentScaleDraftKey,
  readInstrumentScaleDraft,
  writeInstrumentScaleDraft,
  default as InstrumentScaleDialog,
} from './InstrumentScaleDialog';
import { buildBatteryDefinition, STAI_PANAS_BATTERY_SCALE_ID } from './instruments/battery';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('InstrumentScaleDialog Draft Persistence & Recovery', () => {
  const definition = buildBatteryDefinition();

  it('generates the standard mental_scale_draft_${definition.id} storage key', () => {
    const key = getInstrumentScaleDraftKey(definition);
    expect(key).toBe(`mental_scale_draft_${STAI_PANAS_BATTERY_SCALE_ID}`);

    const customKey = getInstrumentScaleDraftKey({
      id: 'custom_scale_id',
      scaleId: STAI_PANAS_BATTERY_SCALE_ID,
    });
    expect(customKey).toBe('mental_scale_draft_custom_scale_id');
  });

  it('correctly writes, reads, and clears drafts in storage', () => {
    const storage = createMemoryStorage();
    const key = getInstrumentScaleDraftKey(definition);

    // Initial state: empty
    expect(readInstrumentScaleDraft(storage, key)).toBeNull();

    // Write draft
    const sampleAnswers = {
      stai: { S1: 2, S2: 3 },
      panas: { P1: 4 },
    };
    writeInstrumentScaleDraft(storage, key, sampleAnswers);

    // Read draft
    const restored = readInstrumentScaleDraft(storage, key);
    expect(restored).toEqual(sampleAnswers);

    // Clear draft
    clearInstrumentScaleDraft(storage, key);
    expect(readInstrumentScaleDraft(storage, key)).toBeNull();
  });

  it('returns null on invalid or empty JSON in storage', () => {
    const storage = createMemoryStorage({
      test_key: 'invalid-json{{{',
      empty_key: JSON.stringify({}),
      empty_sections_key: JSON.stringify({ stai: {}, panas: {} }),
    });

    expect(readInstrumentScaleDraft(storage, 'test_key')).toBeNull();
    expect(readInstrumentScaleDraft(storage, 'empty_key')).toBeNull();
    expect(readInstrumentScaleDraft(storage, 'empty_sections_key')).toBeNull();
  });

  it('automatically restores draft and displays gentle recovery notification when draft exists', () => {
    const storage = createMemoryStorage();
    const key = getInstrumentScaleDraftKey(definition);
    writeInstrumentScaleDraft(storage, key, {
      stai: { S1: 1, S2: 2 },
    });

    const html = renderToStaticMarkup(
      createElement(InstrumentScaleDialog, {
        definition,
        storage,
        onComplete: () => undefined,
        onClose: () => undefined,
      }),
    );

    // Gentle restore prompt must be displayed
    expect(html).toContain('已恢复上次未提交的答题进度');
    // The progress bar should reflect the answered question count (2 answered)
    expect(html).toContain('2 / 40');
  });

  it('does not display draft recovery notification when starting clean without draft', () => {
    const storage = createMemoryStorage();

    const html = renderToStaticMarkup(
      createElement(InstrumentScaleDialog, {
        definition,
        storage,
        onComplete: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(html).not.toContain('已恢复上次未提交的答题进度');
    expect(html).toContain('0 / 40');
  });

  it('wires up "丢弃并退出" and submission cleanup in source contracts', () => {
    const source = readFileSync(new URL('./InstrumentScaleDialog.tsx', import.meta.url), 'utf8');

    // Confirm discard button text and handler
    expect(source).toContain('丢弃并退出');
    expect(source).toContain('handleConfirmDiscard');
    expect(source).toContain('clearInstrumentScaleDraft(draftStorage, draftKey);');

    // Submit handler cleanup
    expect(source).toContain('handleComplete = () => {');

    // Restoration on open
    expect(source).toContain('readInstrumentScaleDraft(draftStorage, draftKey)');
    expect(source).toContain('已恢复上次未提交的答题进度');
  });
});
