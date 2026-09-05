import { afterEach, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DevAutoFillButton, {
  applyRandomFill,
  buildRandomFill,
  type ScaleFillItem,
} from './DevAutoFillButton';
import ScaleAnchorGroup, { buildAnchorOptions, selectAnchorValue } from './ScaleAnchorGroup';

/**
 * Component contracts for the shared scale UI. This repo runs vitest in the
 * plain node environment (no jsdom/happy-dom installed, and no new deps are
 * allowed), so markup is asserted through react-dom/server's static renderer
 * and click-paths through the exported pure functions the rendered buttons
 * call exactly (selectAnchorValue / applyRandomFill).
 */

const render = (element: ReactElement) => renderToStaticMarkup(element);

const FILL_ITEMS: ScaleFillItem[] = [
  { id: 'a', minValue: 0, maxValue: 3 },
  { id: 'b', minValue: 1, maxValue: 5 },
  { id: 'c', minValue: 1, maxValue: 9 },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DevAutoFillButton', () => {
  test('renders null when DEV is false (production visibility gate)', () => {
    vi.stubEnv('DEV', false);
    const markup = render(createElement(DevAutoFillButton, {
      items: FILL_ITEMS,
      answeredIds: [],
      onAnswer: () => undefined,
    }));

    expect(markup).toBe('');
  });

  test('renders the dev fill action when DEV is true', () => {
    vi.stubEnv('DEV', true);
    const markup = render(createElement(DevAutoFillButton, {
      items: FILL_ITEMS,
      answeredIds: [],
      onAnswer: () => undefined,
    }));

    expect(markup).toContain('一键填写（开发）');
    expect(markup).not.toContain('清空');
  });

  test('offers the optional clear action only when onClear is provided', () => {
    vi.stubEnv('DEV', true);
    const markup = render(createElement(DevAutoFillButton, {
      items: FILL_ITEMS,
      answeredIds: [],
      onAnswer: () => undefined,
      onClear: () => undefined,
    }));

    expect(markup).toContain('清空');
  });

  test('the click path answers every unanswered key with a legal value and skips answered keys', () => {
    vi.stubEnv('DEV', true);

    for (let iteration = 0; iteration < 60; iteration += 1) {
      const received: Array<{ id: string; value: number }> = [];
      const fill = applyRandomFill(FILL_ITEMS, ['b'], (id, value) => received.push({ id, value }));

      // Full key coverage of the unanswered items, answered keys untouched.
      expect(Object.keys(fill).sort()).toEqual(['a', 'c']);
      expect(received.map(({ id }) => id).sort()).toEqual(['a', 'c']);

      for (const { id, value } of received) {
        const item = FILL_ITEMS.find((entry) => entry.id === id)!;
        expect(item).toBeDefined();
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(item.minValue);
        expect(value).toBeLessThanOrEqual(item.maxValue);
      }
    }
  });

  test('buildRandomFill spans the whole legal range over repeated draws', () => {
    const seen = new Set<number>();
    const item: ScaleFillItem[] = [{ id: 'x', minValue: 1, maxValue: 9 }];

    for (let iteration = 0; iteration < 500; iteration += 1) {
      seen.add(buildRandomFill(item, []).x);
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('ScaleAnchorGroup', () => {
  const PHQ4_LABELS = ['完全不会', '好几天', '一半以上的天数', '几乎每天'];

  test('buildAnchorOptions models the discrete and bipolar layouts', () => {
    // Discrete derives values from minValue + label order (0-3 gate).
    expect(buildAnchorOptions({ layout: 'discrete', minValue: 0, anchorLabels: PHQ4_LABELS }))
      .toEqual([
        { value: 0, label: '完全不会' },
        { value: 1, label: '好几天' },
        { value: 2, label: '一半以上的天数' },
        { value: 3, label: '几乎每天' },
      ]);
    // Discrete 1-5 (PANAS/GEMS).
    expect(buildAnchorOptions({ layout: 'discrete', minValue: 1, anchorLabels: ['一', '二', '三', '四', '五'] })
      .map((option) => option.value))
      .toEqual([1, 2, 3, 4, 5]);
    // Bipolar keeps the explicit 1-9 boundaries.
    expect(buildAnchorOptions({ layout: 'bipolar', minValue: 1, maxValue: 9 }).map((option) => option.value))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('discrete layout (0-3) renders numbered buttons and the selected label below the row', () => {
    const markup = render(createElement(ScaleAnchorGroup, {
      layout: 'discrete',
      minValue: 0,
      anchorLabels: PHQ4_LABELS,
      value: 2,
      onSelect: () => undefined,
      ariaLabel: '做事时提不起劲或没有兴趣',
    }));

    for (const value of [0, 1, 2, 3]) {
      expect(markup).toContain(`>${value}</button>`);
    }
    // Exactly one pressed anchor: the selected value.
    expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    // Only the SELECTED Chinese label renders below the row (5-column labels
    // must never squeeze into the buttons).
    expect(markup).toContain('一半以上的天数');
    expect(markup).not.toContain('完全不会');
    expect(markup).not.toContain('几乎每天');
  });

  test('discrete layout without a selection shows no anchor label', () => {
    const markup = render(createElement(ScaleAnchorGroup, {
      layout: 'discrete',
      minValue: 1,
      anchorLabels: ['完全没有', '有些', '中等程度', '非常明显'],
      onSelect: () => undefined,
      ariaLabel: '我感到镇静',
    }));

    expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(0);
    expect(markup).not.toContain('完全没有');
  });

  test('bipolar layout renders the 1-9 boundaries and both pole labels (SAM)', () => {
    const markup = render(createElement(ScaleAnchorGroup, {
      layout: 'bipolar',
      minValue: 1,
      maxValue: 9,
      lowLabel: '非常不愉快',
      highLabel: '非常愉快',
      value: 9,
      onSelect: () => undefined,
      ariaLabel: '效价',
    }));

    expect((markup.match(/<button /g) ?? []).length).toBe(9);
    expect(markup).toContain('非常不愉快');
    expect(markup).toContain('非常愉快');
    // Boundary buttons: value 1 first, value 9 last, both addressable.
    expect(markup).toContain('aria-label="效价 1"');
    expect(markup).toContain('aria-label="效价 9"');
    expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  test('bipolar aria labels prefer the per-value hint copy when present', () => {
    const markup = render(createElement(ScaleAnchorGroup, {
      layout: 'bipolar',
      minValue: 1,
      maxValue: 9,
      lowLabel: '非常负性',
      highLabel: '非常正性',
      value: 5,
      onSelect: () => undefined,
      ariaLabel: '愉悦度(1 非常负性 ~ 9 非常正性)',
      valueHints: { 1: '非常负性', 5: '中性', 9: '非常正性' },
    }));

    expect(markup).toContain('aria-label="5(中性)"');
    expect(markup).toContain('aria-label="1(非常负性)"');
  });

  test('the selection click-path forwards the option value to onSelect', () => {
    const received: number[] = [];
    // The same handler backs both layouts' buttons.
    selectAnchorValue((value) => received.push(value), { value: 7 });
    selectAnchorValue((value) => received.push(value), { value: 0, label: '完全不会' });

    expect(received).toEqual([7, 0]);
  });
});
