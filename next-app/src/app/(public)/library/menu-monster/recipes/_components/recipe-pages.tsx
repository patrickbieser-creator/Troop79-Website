/**
 * Server pieces the scout recipe pages share: the kicker (Menu Monster › My
 * recipes, the latter being the hub's Recipe Builder tab) and the one-line
 * locked state for anyone who isn't signed in (release 6: any signed-in person writes recipes).
 */

import Link from 'next/link';
import { PageHeader, KickerSep } from '@/app/_components/page-header';
import { MENU_HUB_HREF } from '../../menus/_components/scout-menus';
import w from '../../menus/_components/workspace.module.css';

export const MY_RECIPES_HREF = `${MENU_HUB_HREF}?tab=builder`;

export function RecipeHeader() {
  return (
    <PageHeader
      kicker={
        <>
          <Link href={MENU_HUB_HREF}>Menu Monster</Link>
          <KickerSep />
          <Link href={MY_RECIPES_HREF}>My recipes</Link>
        </>
      }
    />
  );
}

export function RecipeLocked({ next }: { next: string }) {
  return (
    <p className={w.locked}>
      <Link className={w.link} href={`/signin?next=${encodeURIComponent(next)}`}>
        Sign in to write a recipe
      </Link>
      .
    </p>
  );
}
