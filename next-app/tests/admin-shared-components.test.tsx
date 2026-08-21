import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip } from '../src/app/admin/(workspace)/_components/tab-strip';
import { AddButton } from '../src/app/admin/(workspace)/_components/add-button';
import { ActionsMenu } from '../src/app/admin/(workspace)/_components/actions-menu';
import { Badge } from '../src/app/admin/(workspace)/_components/badge';
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogActions
} from '../src/app/admin/(workspace)/_components/dialog';
import { PageTitle } from '../src/app/admin/(workspace)/_components/page-title';
import { Notice } from '../src/app/admin/(workspace)/_components/notice';
import { SortHeader, useSortable } from '../src/app/admin/(workspace)/_components/use-sortable';

/**
 * Phase A of Plans/Admin-Design-System.md — the first shared admin UI
 * components, extracted from the byte-identical copies the 2026-08-21 audit
 * found (pill tabs ×4, green addBtn ×4, Actions ▾ select ×7). These guard
 * the behavioral contract the per-screen copies implemented by hand:
 * tablist semantics with exactly one selected tab, link-vs-button dual
 * rendering, and the Actions ▾ dispatch-then-reset cycle.
 */

const TABS = [
  { key: 'upcoming', label: 'Upcoming', count: 12 },
  { key: 'past', label: 'Past', count: 48 }
];

describe('TabStrip', () => {
  it('TabStrip_RendersCount_WhenCountProvided', () => {
    render(<TabStrip items={TABS} activeKey="upcoming" ariaLabel="Calendar range" />);
    expect(screen.getByRole('tab', { name: /Upcoming/ }).textContent).toContain('12');
  });

  it('TabStrip_OmitsCountPill_WhenCountAbsent', () => {
    render(
      <TabStrip
        items={[{ key: 'a', label: 'Shelf' }]}
        activeKey="a"
        ariaLabel="Library sections"
      />
    );
    expect(screen.getByRole('tab', { name: 'Shelf' }).querySelector('span')).toBeNull();
  });

  it('TabStrip_MarksOnlyActiveTab_AsSelected', () => {
    render(<TabStrip items={TABS} activeKey="past" ariaLabel="Calendar range" />);
    expect(
      screen.getAllByRole('tab', { selected: true }).map((el) => el.textContent)
    ).toEqual(['Past48']);
  });

  it('TabStrip_FiresOnSelect_WhenTabClicked', async () => {
    const onSelect = vi.fn();
    render(
      <TabStrip
        items={[
          { key: 'a', label: 'A', onSelect },
          { key: 'b', label: 'B' }
        ]}
        activeKey="b"
        ariaLabel="Sample"
      />
    );
    await userEvent.click(screen.getByRole('tab', { name: 'A' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('TabStrip_RendersLink_WhenHrefProvided', () => {
    render(
      <TabStrip
        items={[{ key: 'cur', label: 'Current', href: '/admin/news/articles' }]}
        activeKey="cur"
        ariaLabel="Post archive state"
      />
    );
    expect(screen.getByRole('tab', { name: 'Current' }).getAttribute('href')).toBe(
      '/admin/news/articles'
    );
  });
});

describe('AddButton', () => {
  it('AddButton_RendersLink_WhenHrefProvided', () => {
    render(<AddButton href="/admin/news/articles/new">+ Add News</AddButton>);
    expect(screen.getByRole('link', { name: '+ Add News' }).getAttribute('href')).toBe(
      '/admin/news/articles/new'
    );
  });

  it('AddButton_FiresOnClick_WhenRenderedAsButton', async () => {
    const onClick = vi.fn();
    render(<AddButton onClick={onClick}>+ Add Event</AddButton>);
    await userEvent.click(screen.getByRole('button', { name: '+ Add Event' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('AddButton_DisablesTheButton_WhenDisabled', () => {
    render(
      <AddButton onClick={() => {}} disabled>
        Seed from Signups
      </AddButton>
    );
    expect(
      (screen.getByRole('button', { name: 'Seed from Signups' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe('Badge', () => {
  it('SharedBadge_MapsSemanticVariant_ToStatusToken', () => {
    render(<Badge variant="success">Published</Badge>);
    expect(screen.getByText('Published').className).toContain('success');
  });

  it('SharedBadge_DefaultsToNeutral_WhenNoVariantGiven', () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText('Draft').className).toContain('neutral');
  });
});

describe('Dialog', () => {
  it('SharedDialog_RendersHeaderBodyActions_AsBandedZones', () => {
    render(
      <Dialog open onClose={() => {}}>
        <DialogHeader title="Edit calendar entry" sub="Changes apply immediately when saved." />
        <DialogBody>Body content</DialogBody>
        <DialogActions>
          <button type="button">Save</button>
        </DialogActions>
      </Dialog>
    );
    expect(screen.getByRole('heading', { name: 'Edit calendar entry' })).toBeTruthy();
    expect(screen.getByText('Changes apply immediately when saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('SharedDialog_AppliesDangerVariant_WhenDangerSet', () => {
    render(
      <Dialog open danger onClose={() => {}} data-testid="dlg">
        <DialogBody>Delete?</DialogBody>
      </Dialog>
    );
    expect(screen.getByTestId('dlg').className).toContain('danger');
  });

  it('SharedDialog_AppendsClassName_ForWidthVariants', () => {
    render(
      <Dialog open className="wideOverride" data-testid="dlg">
        <DialogBody>Wide</DialogBody>
      </Dialog>
    );
    const cls = screen.getByTestId('dlg').className;
    expect(cls).toContain('wideOverride');
    expect(cls).toContain('dialog');
  });

  it('SharedDialog_ClosesOnBackdropClick_ButNotOnInnerClick', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} data-testid="dlg">
        <DialogBody>Inner content</DialogBody>
      </Dialog>
    );
    await userEvent.click(screen.getByText('Inner content'));
    expect(onClose).not.toHaveBeenCalled();
    // A click landing on the <dialog> element itself is only possible on the
    // backdrop — the banded header/body/actions zones cover the whole box.
    await userEvent.click(screen.getByTestId('dlg'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('SharedDialog_KeepsOpen_WhenBackdropClickedAndCloseOnBackdropFalse', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open closeOnBackdrop={false} onClose={onClose} data-testid="dlg">
        <DialogBody>Guarded content</DialogBody>
      </Dialog>
    );
    // The consumer owns the close decision (e.g. fast-entry's unsaved-ticks
    // guard) — a backdrop click must not silently close the dialog.
    await userEvent.click(screen.getByTestId('dlg'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('SharedDialog_FiresOnBackdropAttempt_WhenCloseOnBackdropFalse', async () => {
    const onBackdropAttempt = vi.fn();
    render(
      <Dialog open closeOnBackdrop={false} onBackdropAttempt={onBackdropAttempt} data-testid="dlg">
        <DialogBody>Guarded content</DialogBody>
      </Dialog>
    );
    await userEvent.click(screen.getByTestId('dlg'));
    expect(onBackdropAttempt).toHaveBeenCalledOnce();
  });
});

describe('PageTitle', () => {
  it('SharedPageTitle_RendersHeadingSubAndActions', () => {
    render(
      <PageTitle title="Calendar" sub="Everything that happens on a date.">
        <button type="button">+ Add Event</button>
      </PageTitle>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeTruthy();
    expect(screen.getByText('Everything that happens on a date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Add Event' })).toBeTruthy();
  });

  it('SharedPageTitle_OmitsSub_WhenAbsent', () => {
    render(<PageTitle title="Utilities" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Utilities' });
    expect(heading.parentElement?.querySelector('p')).toBeNull();
  });
});

describe('Notice', () => {
  it('SharedNotice_MapsVariant_ToStatusToken', () => {
    render(<Notice variant="success">Import complete — 3 people added.</Notice>);
    expect(screen.getByText('Import complete — 3 people added.').className).toContain('success');
  });

  it('SharedNotice_DefaultsToError_WithAlertRole', () => {
    render(<Notice>Something went wrong saving this row.</Notice>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('error');
  });
});

describe('ActionsMenu', () => {
  it('ActionsMenu_FiresHandler_WhenOptionPicked', async () => {
    const onAction = vi.fn();
    render(
      <ActionsMenu
        ariaLabel="Finance actions"
        options={[
          { value: 'record', label: 'Record a transaction' },
          { value: 'transfer', label: 'Transfer between accounts' }
        ]}
        onAction={onAction}
      />
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Finance actions' }), 'record');
    expect(onAction).toHaveBeenCalledExactlyOnceWith('record');
  });

  it('ActionsMenu_DisablesTheWholeControl_WhenDisabled', () => {
    render(
      <ActionsMenu
        ariaLabel="Report actions"
        disabled
        options={[{ value: 'publish', label: 'Publish' }]}
        onAction={() => {}}
      />
    );
    expect(
      (screen.getByRole('combobox', { name: 'Report actions' }) as HTMLSelectElement).disabled
    ).toBe(true);
  });

  it('ActionsMenu_ResetsToPlaceholder_AfterDispatch', async () => {
    render(
      <ActionsMenu
        ariaLabel="Finance actions"
        options={[{ value: 'record', label: 'Record a transaction' }]}
        onAction={() => {}}
      />
    );
    const select = screen.getByRole('combobox', { name: 'Finance actions' }) as HTMLSelectElement;
    await userEvent.selectOptions(select, 'record');
    expect(select.value).toBe('');
  });
});

describe('SortHeader', () => {
  it('SharedSortHeader_FiresSortCallback_WhenClicked', async () => {
    const toggle = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Name" colKey="name" sortKey="name" sortDir="asc" toggle={toggle} />
          </tr>
        </thead>
      </table>
    );
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(toggle).toHaveBeenCalledExactlyOnceWith('name');
  });

  it('SharedSortHeader_AnnouncesAriaSort_WhenActive', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Rank" colKey="rank" sortKey="rank" sortDir="desc" toggle={() => {}} />
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending');
  });

  it('SharedSortHeader_ReportsNone_WhenInactive', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Age" colKey="age" sortKey="name" sortDir="asc" toggle={() => {}} />
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none');
  });
});

/* Module scope on purpose — useSortable's getValue contract. */
function probeValue(row: { kind: string; name: string }, key: 'name'): unknown {
  return key === 'name' ? row.name : undefined;
}

describe('useSortable', () => {
  function Probe({ rows }: { rows: { kind: string; name: string }[] }) {
    const { sorted, sortKey, sortDir, toggle } = useSortable<{ kind: string; name: string }, 'name'>(
      rows,
      probeValue,
      null
    );
    return (
      <div>
        <output data-testid="order">{sorted.map((r) => r.name).join(',')}</output>
        <table>
          <thead>
            <tr>
              <SortHeader label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
            </tr>
          </thead>
        </table>
      </div>
    );
  }

  it('SharedUseSortable_PreservesInputOrder_WhenInitialKeyNull', () => {
    render(<Probe rows={[{ kind: 'scout', name: 'Zoe' }, { kind: 'adult', name: 'Al' }]} />);
    expect(screen.getByTestId('order').textContent).toBe('Zoe,Al');
  });

  it('SharedUseSortable_SortsAscending_OnFirstToggle', async () => {
    render(<Probe rows={[{ kind: 'scout', name: 'Zoe' }, { kind: 'adult', name: 'Al' }]} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(screen.getByTestId('order').textContent).toBe('Al,Zoe');
  });
});
