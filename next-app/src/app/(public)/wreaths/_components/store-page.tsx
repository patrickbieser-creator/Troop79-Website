/**
 * The page body shared by /wreaths (the troop's general store) and /wreaths/<scout> (a scout's own link). A server
 * component: it renders the deadline band and the heading, then hands the products to the client StoreView. Dates
 * come from lib/format-date; the "Where the money goes" copy is a code constant until it moves to Admin › Pages.
 */
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { fmtDay } from '@/lib/format-date';
import { distributionDay, distributionLine, moneyBlockLines } from '@/lib/wreaths/copy';
import type { StorePageData } from '@/lib/wreaths/store-page';
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

export function StorePage({ data }: { data: StorePageData }) {
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
  const money = moneyBlockLines(first, day);
  const head = scout ? (
    <>
      <p className={styles.kicker}>Troop 79 Christmas wreaths</p>
      <h1 className={styles.title}>You’re ordering from {scout.name}</h1>
      <div className={styles.intro}>
        <div className={styles.greet}>
          {scout.message && <blockquote>{scout.message}</blockquote>}
          <p className={styles.meta}>
            {scout.firstName} delivers your order in person{day ? `, after distribution day, ${day}` : ''}.
          </p>
        </div>
        <MoneyBlock lines={money} />
      </div>
    </>
  ) : (
    <>
      {linkFellBack && (
        <Notice tone="warning" className={styles.stack}>
          That scout link isn’t active this year. You can still order here; orders here go to Troop 79.
        </Notice>
      )}
      <p className={styles.kicker}>Troop 79 wreath sale {state.sale.year}</p>
      <h1 className={styles.title}>Christmas wreaths</h1>
      <p className={styles.lede}>
        Fresh wreaths, roping and trees, sold by the scouts of Troop 79. Pick up{dist.place ? ` at ${dist.place}` : ''} or have them delivered in Milwaukee.
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
        />
      </PageShell>
    </>
  );
}
