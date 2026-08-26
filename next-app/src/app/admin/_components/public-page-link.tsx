/**
 * The admin → public link, one way everywhere (Patrick + Jenna, 2026-08-25):
 * a secondary/sm Button, same tab (Back-nav brings the leader back), labelled
 * "View public page" — or "Preview (unpublished)" while the thing is a draft,
 * never hidden: a leader should not have to guess whether a public page exists.
 *
 * Slot: a `PageTitle`'s children (its right-side actions), or the screen's
 * `.headActions` where there is no PageTitle (calendar workbench, meeting
 * editor). Never the `sub` slot — that is the description.
 */
import { Button } from './button';

export function PublicPageLink({ href, draft = false }: { href: string; draft?: boolean }) {
  return (
    <Button href={href} variant="secondary" size="sm">
      {draft ? 'Preview (unpublished)' : 'View public page'}
    </Button>
  );
}
