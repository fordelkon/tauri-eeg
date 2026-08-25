export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Renders a red confirm action (destructive operations). */
  destructive?: boolean;
  /** Hides the cancel action — an acknowledgement dialog, not a choice. */
  hideCancel?: boolean;
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

/**
 * Framework-free state machine behind `useConfirmDialog`, split out so the
 * promise semantics (resolve/reject paths, consecutive-request behavior) can
 * be unit-tested in the node vitest environment without a DOM renderer.
 */
export const createConfirmController = () => {
  let pending: PendingConfirm | null = null;

  return {
    /** Opens a confirm prompt and returns a promise settled by `settle`. */
    request(options: ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        pending = { options, resolve };
      });
    },

    /** Resolves the newest pending request and closes the prompt. */
    settle(confirmed: boolean): void {
      pending?.resolve(confirmed);
      pending = null;
    },

    /** Options of the currently pending request, or null when idle. */
    get options(): ConfirmOptions | null {
      return pending?.options ?? null;
    },
  };
};

export type ConfirmController = ReturnType<typeof createConfirmController>;
