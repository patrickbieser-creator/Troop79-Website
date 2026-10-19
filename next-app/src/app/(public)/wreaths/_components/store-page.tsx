/**
 * The page body shared by /wreaths (the troop's general store) and /wreaths/<scout> (a scout's own link). A server
 * component: it renders the deadline band and the heading, then hands the products to the client StoreView. Dates
 * come from lib/format-date; the "Where the money goes" copy is a code constant until it moves to Admin › Pages.
 */
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { fmtDay } from '@/lib/format-date';
import { LINK_NOT_FOUND, distributionDay, distributionLine, moneyBlockLines } from '@/lib/wreaths/copy';
import { fmtMoney } from '@/lib/wreaths/rules';
import type { StorePageData } from '@/lib/wreaths/store-page';
import { GoalBar } from '@/app/_components/goal-bar';
import type { GoalProgress } from '@/lib/wreaths/scout-entry';
import { EntrySwitch, type EntryConfig } from './entry-mode';
import { StoreView } from './store-view';
import styles from '../wreaths.module.css';

function MoneyBlock({ lines }: { lines: string[] }) {
  return (
    <div className={`${styles.card} ${styles.pad} ${styles.money}`}>
      <h2>Where the money goes</h2>
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

export function StorePage({ data, entry, goal, donations = 0 }: { data: StorePageData; entry?: EntryConfig; goal?: GoalProgress | null; /** Cash donations raised on the scout's live orders. */ donations?: number }) {
  const { state, scout, linkFellBack } = data;
  const first = scout?.firstName ?? null;

  if (state.kind === 'not_open') {
    return (
      <PageShell>
        <p className={styles.kicker}>Troop 79 wreath sale</p>
        <h1 className={styles.title}>Christmas wreaths</h1>
        <Notice tone="info">The Troop 79 wreath sale isn’t open yet. Check back soon, or ask a scout for their link.</Notice>
      </PageShell>
    );
  }

  const dist = { date: state.sale.distributionDate, window: state.sale.distributionWindow, place: state.sale.distributionPlace };
  const open = state.kind === 'open' && !state.graceCutoff;

  if (!open) {
    return (
      <>
        <div className={styles.deadline}>
          <div className={styles.deadlineInner}>
            <strong>Sales are closed for {state.sale.year}</strong>
            <span className={styles.deadlineSoft}>Thank you! Next year’s sale opens in October.</span>
          </div>
        </div>
        <PageShell>
          <p className={styles.kicker}>Troop 79 Christmas wreaths</p>
          <h1 className={styles.title}>{scout ? `${scout.name}’s wreath sale is closed` : 'Christmas wreaths'}</h1>
          <Notice tone="info">
            Sales are closed for {state.sale.year}. Thank you{scout ? ` for supporting ${scout.firstName} and` : ' for supporting'} Troop 79. If you already ordered, distribution is{' '}
            {distributionLine(dist) || 'on the date in your confirmation email'}.
          </Notice>
        </PageShell>
      </>
    );
  }

  const day = distributionDay(dist);
  const money = moneyBlockLines(first, state.sale);
  const head = scout ? (
    <>
      <p className={styles.kicker}>Troop 79 Christmas wreaths</p>
      <h1 className={styles.title}>You’re ordering from {scout.name}</h1>
      <EntrySwitch />
      <div className={styles.intro}>
        <div className={styles.greet}>
          <GoalBar progress={goal ?? null} />
          {donations > 0 && <p className={styles.meta}>{goal ? `Plus ${fmtMoney(donations)} in donations` : `${fmtMoney(donations)} in donations so far`}</p>}
          <p className={styles.meta}>{scout.deliveryMessage ?? `${scout.firstName} delivers your order in person${day ? `, after distribution day, ${day}` : ''}.`}</p>
        </div>
        <MoneyBlock lines={money} />
      </div>
    </>
  ) : (
    <>
      {linkFellBack && (
        <Notice tone="warning" className={styles.stack}>
          {LINK_NOT_FOUND}
        </Notice>
      )}
      <p className={styles.kicker}>Troop 79 wreath sale {state.sale.year}</p>
      <h1 className={styles.title}>Christmas wreaths</h1>
      <p className={styles.lede}>
        Fresh wreaths, roping and garland, to benefit the scouts of Troop 79. Delivered to your home in Milwaukee, or pick up at
        Northwoods parking lot, 1572 East Capitol on Saturday November 21st.
      </p>
      <div className={styles.intro}>
        <MoneyBlock lines={money} />
      </div>
    </>
  );

  return (
    <>
      <div className={styles.deadline}>
        <div className={styles.deadlineInner}>
          <strong>{state.round === 1 ? `Order by ${fmtDay(state.cutoff)}` : `Last orders ${fmtDay(state.cutoff)}`}</strong>
          <span className={styles.deadlineSoft}>
            {state.daysLeft === 0 ? 'Ends today' : `${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`}
            {state.round === 1 ? ` · last orders ${fmtDay(state.sale.round2Cutoff)}` : ''}
          </span>
        </div>
      </div>
      <PageShell>
        <StoreView
          items={state.items}
          scout={scout ? { slug: scout.slug, name: scout.name, firstName: scout.firstName } : null}
          head={head}
          linkFellBack={linkFellBack}
          entry={entry}
          donationShare={state.sale.donationShare}
        />
      </PageShell>
    </>
  );
}
