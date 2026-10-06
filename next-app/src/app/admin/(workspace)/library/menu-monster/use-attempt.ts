'use client';

import { useEffect, useState } from 'react';

/**
 * The "tried to save an incomplete form" state (D-331), for the small forms that have no tabs: after a
 * click on a Save/Add that can't happen, `attempted` turns on (the bad fields are marked and a
 * <SaveProblem> is shown), and focus goes to the first marked field inside `container`.
 * `clear` drops it again (Discard, Cancel).
 */
export function useAttempt<T extends HTMLElement = HTMLDivElement>() {
  const [attempted, setAttempted] = useState(false);
  const [ask, setAsk] = useState(0);
  // A callback ref held in state (not a ref object): the lint forbids reading a ref's holder during render.
  const [box, container] = useState<T | null>(null);
  useEffect(() => {
    if (ask === 0) return;
    const bad = box?.querySelector<HTMLElement>('[aria-invalid="true"]');
    bad?.scrollIntoView?.({ block: 'center' });
    bad?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per refusal, not when the box mounts
  }, [ask]);
  return {
    attempted,
    container,
    refuse: () => {
      setAttempted(true);
      setAsk((n) => n + 1);
    },
    clear: () => setAttempted(false)
  };
}

/** A field that can't be saved as it stands: the sentence under it, and the clause beside the button. */
export interface FieldProblem {
  field: string;
  note: string;
  reason: string;
}
