'use client';

/**
 * Dirty-form registry for the workspace (Patrick, 2026-08-25: "When a form is
 * dirty, the back control should prompt discard changes").
 *
 * The three save-state hooks (`useSavedSnapshot`, `useDraftSnapshot`,
 * `useFormDirty`) register their `dirty` flag here, so every admin edit form
 * takes part without any per-form wiring; `BackNav` asks `isDirty()` before it
 * navigates and shows the Discard-changes dialog when the answer is yes.
 * Outside the provider (tests, the print pages) the hook is a no-op.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';

interface DirtyGuard {
  register: (id: string, dirty: boolean) => void;
  isDirty: () => boolean;
}

const Ctx = createContext<DirtyGuard | null>(null);

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirtyIds = useRef(new Set<string>());
  const register = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
  }, []);
  const isDirty = useCallback(() => dirtyIds.current.size > 0, []);
  const value = useMemo<DirtyGuard>(() => ({ register, isDirty }), [register, isDirty]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Called by the save-state hooks — one registration per form, cleared on unmount. */
export function useRegisterDirty(dirty: boolean): void {
  const ctx = useContext(Ctx);
  const id = useId();
  useEffect(() => {
    if (!ctx) return;
    ctx.register(id, dirty);
    return () => ctx.register(id, false);
  }, [ctx, id, dirty]);
}

export function useDirtyGuard(): DirtyGuard | null {
  return useContext(Ctx);
}
