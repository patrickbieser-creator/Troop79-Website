import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditBar } from '../src/app/admin/(workspace)/_components/edit-bar';
import {
  DirtyGuardProvider,
  useDirtyGuard,
} from '../src/app/admin/(workspace)/_components/dirty-guard';
import { PatrolTable } from '../src/app/admin/(workspace)/advancement/roster/patrols/patrol-table';
import type { PatrolScout } from '../src/lib/patrol-assign';

/**
 * The shared save bar (Plans/Shared-Save-Bar.md): one sticky bar on every edit screen that
 * always says whether there are unsaved changes, and protects them — the dirty guard and the
 * browser's leave prompt both know while it is dirty. Patrols is the first screen on it
 * (2026-11-15: a leader reassigned scouts, never saw the bottom-of-page Save, and left).
 */
const noop = () => {};

function bar(props: Partial<Parameters<typeof EditBar>[0]> = {}) {
  return (
    <EditBar
      dirty={false}
      pending={false}
      onSave={noop}
      onDiscard={noop}
      {...props}
    />
  );
}

function unloadEvent() {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe('EditBar', () => {
  it('EditBar_ShowsUnsavedCount_WhenDirty', () => {
    render(bar({ dirty: true, changes: 3 }));
    expect(
      screen.getByRole('region', { name: 'Save changes' }).textContent,
    ).toContain('3 unsaved changes — Save to keep them');
  });

  it('EditBar_ShowsCleanStatus_WhenNotDirty', () => {
    render(bar({ cleanStatus: 'Every scout is in a patrol' }));
    expect(
      screen.getByRole('region', { name: 'Save changes' }).textContent,
    ).toContain('Every scout is in a patrol');
  });

  it('EditBar_DefaultsCleanStatusToAllSaved_WhenNoneGiven', () => {
    render(bar());
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('EditBar_CallsOnSave_WhenSaveClicked', async () => {
    const onSave = vi.fn();
    render(bar({ dirty: true, changes: 1, onSave }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('EditBar_PromptsOnUnload_WhenDirty', () => {
    render(bar({ dirty: true, changes: 1 }));
    expect(unloadEvent().defaultPrevented).toBe(true);
  });

  it('EditBar_DoesNotPrompt_WhenClean', () => {
    render(bar());
    expect(unloadEvent().defaultPrevented).toBe(false);
  });

  it('EditBar_RegistersWithDirtyGuard_WhenDirty', () => {
    let isDirty = () => false;
    function Probe() {
      const guard = useDirtyGuard();
      useEffect(() => {
        if (guard) isDirty = guard.isDirty;
      }, [guard]);
      return null;
    }
    render(
      <DirtyGuardProvider>
        <Probe />
        {bar({ dirty: true, changes: 2 })}
      </DirtyGuardProvider>,
    );
    expect(isDirty()).toBe(true);
  });
});

const scouts: PatrolScout[] = [
  {
    id: 'T01',
    display_name: 'Ada Able',
    patrol: null,
    current_rank: null,
    graduation_year: null,
    active: true,
  },
  {
    id: 'T02',
    display_name: 'Ben Baker',
    patrol: 'Hawks',
    current_rank: null,
    graduation_year: null,
    active: true,
  },
];

describe('Patrols on the shared save bar', () => {
  it('PatrolScreen_ShowsPendingInTopBar_AfterAssign', () => {
    render(
      <PatrolTable
        scouts={scouts}
        ranks={[]}
        onSave={async () => ({ ok: true, changed: 1 })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Patrol for Ada Able'), {
      target: { value: 'Hawks' },
    });
    expect(
      screen.getByRole('region', { name: 'Save changes' }).textContent,
    ).toContain('1 unsaved change — Save to keep them');
  });

  it('PatrolScreen_SaveBarIsAboveTable', () => {
    render(
      <PatrolTable
        scouts={scouts}
        ranks={[]}
        onSave={async () => ({ ok: true, changed: 0 })}
      />,
    );
    const region = screen.getByRole('region', { name: 'Save changes' });
    const table = screen.getByRole('table');
    expect(
      region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('PatrolScreen_HasOnePrimaryButton_SaveOnly', () => {
    render(
      <PatrolTable
        scouts={scouts}
        ranks={[]}
        onSave={async () => ({ ok: true, changed: 0 })}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Save changes' })).getByRole(
        'button',
        { name: 'Saved' },
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Assign/ }).className,
    ).not.toMatch(/primary/);
  });
});
