import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  typeToConfirm?: string;
}
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** Promise-based confirm dialog: `if (await confirm({ title: 'Delete?', danger: true })) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback<ConfirmFn>(o => new Promise(resolve => {
    resolver.current = resolve; setTyped(''); setOpts(o);
  }), []);
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = undefined; setOpts(null); };
  const blocked = !!opts?.typeToConfirm && typed !== opts.typeToConfirm;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onClose={() => close(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{opts?.title}</DialogTitle>
        <DialogContent>
          {opts?.message && (typeof opts.message === 'string'
            ? <Typography variant="body2">{opts.message}</Typography> : opts.message)}
          {opts?.typeToConfirm && (
            <TextField fullWidth size="small" sx={{ mt: 2 }} autoFocus value={typed} onChange={e => setTyped(e.target.value)}
              label={t('common.typeToConfirm', { text: opts.typeToConfirm })} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" color={opts?.danger ? 'error' : 'primary'} disabled={blocked} onClick={() => close(true)}>
            {opts?.confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/**
 * Shorthand for message-style confirms: the first line is the title, the rest the message.
 * Deleting/deactivating/discarding is shown as a danger action.
 */
export function useAsk() {
  const confirm = useConfirm();
  return useCallback((text: string) => {
    const [title, ...rest] = text.split('\n');
    return confirm({ title, message: rest.join('\n').trim() || undefined, danger: /delete|deactivat|remove|discard/i.test(title) });
  }, [confirm]);
}
