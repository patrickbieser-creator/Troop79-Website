'use client';

/**
 * Client-side specimen wrappers for /admin/styleguide. The styleguide page
 * is a server component, so it can't pass handler props (onAction/onSelect)
 * to client components — these thin wrappers supply inert handlers instead.
 * Display-only: nothing here appears outside the styleguide.
 */
import { ActionsMenu } from '../_components/actions-menu';

export function ActionsMenuSpecimen() {
  return (
    <ActionsMenu
      ariaLabel="Sample actions"
      options={[
        { value: 'record', label: 'Record a transaction' },
        { value: 'export', label: 'Export CSV (backup)' }
      ]}
      onAction={() => {}}
    />
  );
}
