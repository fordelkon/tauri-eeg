import { describe, expect, it } from 'vitest';
import { createConfirmController } from './confirmController';

describe('confirmController', () => {
  it('starts idle with no pending options', () => {
    const controller = createConfirmController();
    expect(controller.options).toBeNull();
  });

  it('resolves true on confirm and false on cancel', async () => {
    const controller = createConfirmController();

    const confirmed = controller.request({ title: '删除?' });
    expect(controller.options?.title).toBe('删除?');
    controller.settle(true);
    await expect(confirmed).resolves.toBe(true);

    const cancelled = controller.request({ title: '离开?' });
    controller.settle(false);
    await expect(cancelled).resolves.toBe(false);

    expect(controller.options).toBeNull();
  });

  it('a superseded request keeps its promise pending while the newest wins', async () => {
    const controller = createConfirmController();

    const first = controller.request({ title: 'first' });
    const second = controller.request({ title: 'second' });

    // Only the newest prompt is visible and settleable.
    expect(controller.options?.title).toBe('second');
    controller.settle(true);
    await expect(second).resolves.toBe(true);

    // The displaced promise never settles — document the known single-dialog
    // semantic so callers know not to fire concurrent confirms.
    const loser = await Promise.race([
      first.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);
    expect(loser).toBe('pending');
  });
});
