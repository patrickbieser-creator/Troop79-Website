import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetSelect, type MbRequirementOption } from '../src/app/admin/(workspace)/library/target-select';
import type { TargetOptionGroup } from '../src/app/admin/(workspace)/library/resource-entry-form';

/**
 * The admin Library placement / narrative target picker
 * (Plans/Library-MB-Consolidation.md, Phase 3). Picking a merit badge
 * reveals a second control — "Whole badge" (the `mb:` target, default) or
 * one of THAT badge's requirements, loaded on demand for the selected badge
 * only — and the form field carries the composed value the write path
 * already accepts (`mb_req:{mbId}-{code}`). Rank and topic targets are
 * untouched: same optgroups, same values, no second step.
 */

const GROUPS: TargetOptionGroup[] = [
  { group: 'Topic shelves', options: [{ value: 'topic:knots', label: 'Knots' }] },
  {
    group: 'Tenderfoot requirements',
    options: [
      { value: 'rank_req:tenderfoot-1a', label: 'Tenderfoot 1a — Present yourself' },
      { value: 'rank_req:tenderfoot-1b', label: 'Tenderfoot 1b — Spend a night' }
    ]
  },
  {
    group: 'Merit badges',
    options: [
      { value: 'mb:chemistry', label: 'Chemistry' },
      { value: 'mb:first-aid', label: 'First Aid' }
    ]
  }
];

const CHEMISTRY: MbRequirementOption[] = [
  { value: 'mb_req:chemistry-1', code: '1', label: 'Chemical safety rules', depth: 0 },
  { value: 'mb_req:chemistry-4', code: '4', label: 'Safety', depth: 0 },
  { value: 'mb_req:chemistry-4a', code: '4a', label: 'Compare two waterproofing methods', depth: 1 },
  { value: 'mb_req:chemistry-4b', code: '4b', label: 'Describe the four classes of fires', depth: 1 }
];

function loader() {
  return vi.fn(async (mbId: string) => (mbId === 'chemistry' ? CHEMISTRY : []));
}

function fieldValue(container: HTMLElement, name = 'target'): string | null {
  return container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? null;
}

describe('TargetSelect — badge → requirement two-step', () => {
  it('Webmaster_PicksMeritBadge_SeesWholeBadgeAndRequirementChoice', async () => {
    const load = loader();
    const user = userEvent.setup();
    const { container } = render(
      <TargetSelect groups={GROUPS} name="target" includeMbReq loadMbRequirementOptions={load} />
    );

    // No second step until a badge is chosen.
    expect(screen.queryByLabelText('Requirement')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Target page'), 'mb:chemistry');

    const reqSelect = await screen.findByLabelText('Requirement');
    await within(reqSelect).findByRole('option', { name: /4b · Describe/ });
    const options = within(reqSelect).getAllByRole('option');
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Whole badge',
      '1 · Chemical safety rules',
      '4 · Safety',
      '4a · Compare two waterproofing methods',
      '4b · Describe the four classes of fires'
    ]);
    // Leaves are visibly nested under their parent.
    expect(options[3].textContent!.startsWith(' ')).toBe(true);
    expect(options[1].textContent!.startsWith(' ')).toBe(false);
    // Whole badge is the default, so the field is the plain mb: target.
    expect((reqSelect as HTMLSelectElement).value).toBe('');
    expect(fieldValue(container)).toBe('mb:chemistry');
    // Loaded for this badge only, once.
    expect(load.mock.calls).toEqual([['chemistry']]);
  });

  it('Webmaster_PicksRequirement_EmitsMbReqValue', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TargetSelect groups={GROUPS} name="target" includeMbReq loadMbRequirementOptions={loader()} />
    );
    await user.selectOptions(screen.getByLabelText('Target page'), 'mb:chemistry');
    const reqSelect = await screen.findByLabelText('Requirement');
    await within(reqSelect).findByRole('option', { name: /4a · Compare/ });

    await user.selectOptions(reqSelect, '4a');
    expect(fieldValue(container)).toBe('mb_req:chemistry-4a');

    // Back to the whole badge drops the requirement again.
    await user.selectOptions(reqSelect, '');
    expect(fieldValue(container)).toBe('mb:chemistry');
  });

  it('Webmaster_SwitchesBadge_RequirementChoiceResetsAndReloads', async () => {
    const load = loader();
    const user = userEvent.setup();
    const { container } = render(
      <TargetSelect groups={GROUPS} name="target" includeMbReq loadMbRequirementOptions={load} />
    );
    await user.selectOptions(screen.getByLabelText('Target page'), 'mb:chemistry');
    const reqSelect = await screen.findByLabelText('Requirement');
    await within(reqSelect).findByRole('option', { name: /4a · Compare/ });
    await user.selectOptions(reqSelect, '4a');
    expect(fieldValue(container)).toBe('mb_req:chemistry-4a');

    await user.selectOptions(screen.getByLabelText('Target page'), 'mb:first-aid');
    // A stale 4a must never be composed onto the new badge.
    expect(fieldValue(container)).toBe('mb:first-aid');
    expect(load.mock.calls).toEqual([['chemistry'], ['first-aid']]);
  });

  it('NarrativeEditor_ReopensExistingMbReqTarget_InBothSteps', async () => {
    // The Narratives tab reloads with ?target=mb_req:chemistry-4b after a
    // save, and from the "Existing narratives" list — both steps must show it.
    const { container } = render(
      <TargetSelect
        groups={GROUPS}
        name="target"
        includeMbReq
        defaultValue="mb_req:chemistry-4b"
        loadMbRequirementOptions={loader()}
      />
    );
    expect((screen.getByLabelText('Target page') as HTMLSelectElement).value).toBe('mb:chemistry');
    const reqSelect = await screen.findByLabelText('Requirement');
    await within(reqSelect).findByRole('option', { name: /4b · Describe/ });
    expect((reqSelect as HTMLSelectElement).value).toBe('4b');
    expect(fieldValue(container)).toBe('mb_req:chemistry-4b');
  });

  it('RankPages_Unaffected_WhenMbReqOptionsAddedToTargetSelect', async () => {
    const load = loader();
    const user = userEvent.setup();

    const withoutOptgroups = () =>
      [...screen.getByLabelText('Target page').querySelectorAll('optgroup')].map((g) => ({
        label: g.label,
        options: [...g.querySelectorAll('option')].map((o) => [o.value, o.textContent])
      }));

    const off = render(
      <TargetSelect groups={GROUPS} name="target" includeMbReq={false} loadMbRequirementOptions={load} />
    );
    const offGroups = withoutOptgroups();
    const offSelect = screen.getByLabelText('Target page');
    expect(offSelect).toBe(screen.getByRole('combobox')); // the only control
    off.unmount();

    const on = render(
      <TargetSelect groups={GROUPS} name="target" includeMbReq loadMbRequirementOptions={load} />
    );
    // Same optgroups, values and labels whether or not the mb_req step is on.
    expect(withoutOptgroups()).toEqual(offGroups);
    expect(offGroups.map((g) => g.label)).toEqual([
      'Topic shelves',
      'Tenderfoot requirements',
      'Merit badges'
    ]);

    // A rank requirement is a one-step pick: no second control, no load.
    await user.selectOptions(screen.getByLabelText('Target page'), 'rank_req:tenderfoot-1b');
    expect(screen.queryByLabelText('Requirement')).toBeNull();
    expect(fieldValue(on.container)).toBe('rank_req:tenderfoot-1b');
    expect(load).not.toHaveBeenCalled();
  });
});
