'use client';

/**
 * The hub's Ingredients tab: the troop's price book as a scout reads it, in the
 * recipe library's look (recipe-browser.tsx). Search, a "Show" row of store
 * sections, then one row per ingredient with its lowest price; its name opens the
 * packages it is sold in (price, store) and the diets it doesn't suit. What shows
 * is lib/menu-monster/ingredient-browse.ts browseIngredients().
 *
 * Anyone signed in can add an ingredient the book lacks (`adder`): a leader who
 * keeps the price book adds it at once ('live'); anyone else sends it to a leader
 * ('review') and sees it here, tagged "Waiting for a leader", until one decides.
 * A visitor (null) gets a sign-in link.
 */

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/button';
import type { Catalog, Section } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY, SECTIONS, SECTION_ORDER, priceText } from '@/lib/menu-monster/units';
import { browseIngredients } from '@/lib/menu-monster/ingredient-browse';
import { FilterChips, SearchBox } from './browse-controls';
import { NewIngredientForm } from '../recipes/_components/new-ingredient-form';
import { submitIngredientAction } from '../../_tools/menu-monster/ingredient-actions';
import w from '../menus/_components/workspace.module.css';

const SECTION_CHIPS = SECTION_ORDER.map((key) => ({ key, label: SECTIONS[key] }));

export function IngredientBrowser({ catalog, adder = null, signInHref }: { catalog: Catalog; adder?: 'live' | 'review' | null; signInHref?: string }) {
  const uid = useId();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<Section | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = browseIngredients(catalog, query, section);
  const q = query.trim();

  return (
    <div className={w.browse}>
      <SearchBox label="Search ingredients" value={query} onChange={setQuery} />
      <FilterChips options={SECTION_CHIPS} value={section} onChange={setSection} />
      {adder ? (
        !adding && (
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDone(null);
                setFailure(null);
                setAdding(true);
              }}
            >
              Add an ingredient
            </Button>
          </div>
        )
      ) : (
        signInHref && (
          <p className={w.foot}>
            <Link className={w.link} href={signInHref}>
              Sign in
            </Link>{' '}
            to add an ingredient.
          </p>
        )
      )}
      {adding && (
        <NewIngredientForm
          initialName={q}
          catalog={catalog}
          withSection={adder === 'live'}
          busy={busy}
          failure={failure}
          onCancel={() => setAdding(false)}
          onAdd={(n, aisle) => {
            setFailure(null);
            start(async () => {
              const res = await submitIngredientAction(n, aisle);
              if (!res.ok) {
                setFailure(res.error);
                return;
              }
              setAdding(false);
              setDone(res.status === 'live' ? `“${res.name}” is in the price book.` : `“${res.name}” was sent to a leader to check. Until then only you see it here.`);
              router.refresh();
            });
          }}
        />
      )}
      {done && (
        <p className={w.foot} role="status">
          {done}
        </p>
      )}
      <p className={w.srOnly} aria-live="polite">
        {entries.length === 1 ? '1 ingredient' : `${entries.length} ingredients`}
      </p>
      <ul className={w.card} aria-label="Ingredients">
        {entries.length === 0 && <li className={w.empty}>{q ? `No ingredients match “${q}”.` : 'No ingredients here yet.'}</li>}
        {entries.map(({ ingredient: i, packages, from }) => {
          const open = openId === i.id;
          const panel = `${uid}-i-${i.id}`;
          return (
            <li key={i.id} className={w.row}>
              <div className={w.rowMain}>
                <button type="button" className={w.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpenId(open ? null : i.id)}>
                  {i.name}
                  <span className={w.chev} aria-hidden="true">
                    ›
                  </span>
                </button>
                {i.staple && <span className={w.meta}>Patrol box</span>}
                {i.waiting ? <span className={w.tag}>Waiting for a leader</span> : i.needsMatch && <span className={w.tag}>New</span>}
              </div>
              <div className={w.fitCol}>
                <span className={w.meta}>{from == null ? 'No price yet' : priceText(from)}</span>
              </div>
              {open && (
                <div id={panel} className={w.inset}>
                  {packages.length === 0 ? (
                    <p className={w.insetMuted}>Not in the price book yet.</p>
                  ) : (
                    <ul className={w.plainList} aria-label={`${i.name} packages`}>
                      {packages.map((p) => (
                        <li key={p.id} className={w.insetLine}>
                          {[p.name, priceText(p.price), p.store].filter(Boolean).join(' · ')}
                        </li>
                      ))}
                    </ul>
                  )}
                  {i.avoid.length > 0 && <p className={w.insetMuted}>{i.avoid.map((k) => `Not ${RESTRICTION_BY_KEY[k].label.toLowerCase()}`).join(' · ')}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
