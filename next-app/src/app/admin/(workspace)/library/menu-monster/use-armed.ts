import { useEffect, useState } from 'react';

const ARM_MS = 4000;

/** A two-click arm for the one-way actions (D-070: no confirm()). */
export function useArmed(): { armed: boolean; arm: () => boolean; disarm: () => void } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    armed,
    arm: () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    },
    disarm: () => setArmed(false)
  };
}
