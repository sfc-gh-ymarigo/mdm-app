import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm } from './Confirm';

// One registry of "dirty" editors; a single router blocker (react-router allows only one) reads it.
const dirtySources = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const anyDirty = () => dirtySources.size > 0;

/** Mounted once (Layout): asks before in-app navigation or tab close while any editor is dirty. */
export function UnsavedChangesBlocker() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const dirty = useSyncExternalStore(subscribe, anyDirty);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => anyDirty() && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirm({ title: t('common.unsavedTitle'), message: t('common.unsavedMessage'), confirmLabel: t('common.discard'), danger: true })
      .then(ok => { if (ok) { dirtySources.clear(); emit(); blocker.proceed(); } else blocker.reset(); });
  }, [blocker, confirm, t]);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  return null;
}

/**
 * Register an editor's dirty state. Returns `guard(action)` for local exits such as closing a drawer:
 * runs `action` if clean or once the user confirms discarding.
 */
export function useUnsavedGuard(dirty: boolean) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const id = useId();
  useEffect(() => {
    if (dirty) dirtySources.add(id); else dirtySources.delete(id);
    emit();
    return () => { dirtySources.delete(id); emit(); };
  }, [dirty, id]);

  return useCallback(async (action: () => void) => {
    if (!dirty || await confirm({ title: t('common.unsavedTitle'), message: t('common.unsavedMessage'), confirmLabel: t('common.discard'), danger: true })) {
      dirtySources.delete(id); emit(); action();
    }
  }, [dirty, confirm, t, id]);
}
