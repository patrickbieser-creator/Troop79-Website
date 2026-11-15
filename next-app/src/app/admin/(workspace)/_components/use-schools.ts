'use client';

/**
 * The school list for a SchoolCombobox whose screen didn't load it (the scout create dialog, the record page's
 * scout details). Fetched once on mount through the listSchools server action (leaders only; an empty list on
 * refusal). `loaded` lets a caller tell "no schools yet" from "still loading".
 */
import { useEffect, useState } from 'react';
import { listSchools } from '../advancement/lookups/school-actions';
import type { School } from '@/lib/schools';

export function useSchools(): { schools: School[]; loaded: boolean } {
  const [schools, setSchools] = useState<School[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    listSchools()
      .then((rows) => {
        if (live) setSchools(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return { schools, loaded };
}
