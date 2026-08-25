import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { type ReactElement, useCallback, useState } from 'react';
import { createConfirmController, type ConfirmOptions } from './confirmController';

export type { ConfirmOptions };

/**
 * Promise-based confirmation dialog. Callers `await confirm({...})` instead of
 * wiring ad-hoc state per dialog; render `confirmDialogElement` next to the
 * component tree. Settling only ever resolves the newest request — an older
 * superseded promise stays pending by design (matches single-dialog UI).
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialogElement: ReactElement | null;
} {
  const [controller] = useState(createConfirmController);
  const [, setPending] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending(options);
    return controller.request(options).finally(() => setPending(controller.options));
  }, [controller]);

  const settle = useCallback((confirmed: boolean) => {
    controller.settle(confirmed);
  }, [controller]);

  const options = controller.options;

  const confirmDialogElement = options ? (
    <Dialog
      open
      onClose={() => settle(false)}
      aria-labelledby="confirm-dialog-title"
      aria-describedby={options.description ? 'confirm-dialog-description' : undefined}
    >
      <DialogTitle id="confirm-dialog-title">{options.title}</DialogTitle>
      {options.description ? (
        <DialogContent>
          <DialogContentText id="confirm-dialog-description">
            {options.description}
          </DialogContentText>
        </DialogContent>
      ) : null}
      <DialogActions>
        {options.hideCancel ? null : (
          <Button onClick={() => settle(false)}>{options.cancelText ?? '取消'}</Button>
        )}
        <Button
          color={options.destructive ? 'error' : 'primary'}
          onClick={() => settle(true)}
          autoFocus
        >
          {options.confirmText ?? '确定'}
        </Button>
      </DialogActions>
    </Dialog>
  ) : null;

  return { confirm, confirmDialogElement };
}
