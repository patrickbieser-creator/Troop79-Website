/**
 * /admin/styleguide/help-sample — THROWAWAY tuning page for the ? help badge
 * (Patrick, 2026-08-25: "create a sample test page that can be deleted that
 * shows me what it looks like and how it will behave … make sure we get this
 * tuned before we implement it widely"). Delete this folder once the badge
 * has its specimen on /admin/styleguide/admin. Not in the nav; URL only.
 */
import { PageTitle } from '../../_components/page-title';
import { HelpSample } from './help-sample';

export const metadata = { title: 'Help badge sample — Troop 79' };

export default function HelpSamplePage() {
  return (
    <>
      <PageTitle
        back={{ label: 'Styleguides', href: '/admin/styleguide' }}
        title="Help badge — sample"
        sub={
          <>
            A throwaway page to tune the <code>?</code> badge before it goes everywhere. Use the knobs, try
            hover, click, tap, Tab + Enter, Esc, clicking away, and the right and bottom edges. Component:{' '}
            <code>admin/_components/help-badge.tsx</code>; copy: <code>admin/help.tsx</code>.
          </>
        }
      />
      <HelpSample />
    </>
  );
}
