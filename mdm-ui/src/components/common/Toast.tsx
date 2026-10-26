import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Snackbar, Alert } from '@mui/material';

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';
type Toast = { id: number; msg: string; severity: ToastSeverity };
type ToastFn = (msg: string, severity?: ToastSeverity) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** One app-wide snackbar (bottom-right, 4 s). Use `const toast = useToast(); toast('Saved')`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const show = useCallback<ToastFn>((msg, severity = 'success') => setToast({ id: ++seq.current, msg, severity }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar key={toast?.id} open={!!toast} autoHideDuration={4000} onClose={(_, r) => { if (r !== 'clickaway') setToast(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={toast?.severity ?? 'success'} variant="filled" onClose={() => setToast(null)}>{toast?.msg}</Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
