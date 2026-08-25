'use client';

import { useEffect, useState } from 'react';
import { HelpBadge, type HelpBadgeSize, type HelpPlacement } from '../../../_components/help-badge';
import { FormPanel } from '../../../_components/form-panel';
import { Button } from '../../../_components/button';
import sg from '../admin/styleguide.module.css';
import dlg from '../../_components/dialog.module.css';
import cal from '../../calendar/calendar.module.css';
import styles from './help-sample.module.css';

/** WCAG relative luminance → contrast ratio, from two computed colours. */
function contrast(fg: string, bg: string): number | null {
  const rgb = (s: string) => {
    const m = s.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return null;
    return m.slice(0, 3).map(Number);
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const a = rgb(fg);
  const b = rgb(bg);
  if (!a || !b) return null;
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function HelpSample() {
  const [placement, setPlacement] = useState<HelpPlacement>('auto');
  const [maxWidth, setMaxWidth] = useState(320);
  // Patrick's tuning (2026-08-25): 320 / 20px / click only — now the defaults.
  const [size, setSize] = useState<HelpBadgeSize>(20);
  const [hoverOpens, setHoverOpens] = useState(false);
  const [hoverDelay, setHoverDelay] = useState(150);
  const [ratios, setRatios] = useState<{ body: number | null; title: number | null }>({ body: null, title: null });

  // Read the live tokens so the printed ratio is what actually ships.
  useEffect(() => {
    // After paint, so the tokens are resolved and the lint rule about
    // synchronous setState in an effect is honoured.
    const raf = requestAnimationFrame(() => {
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (v: string) => {
        probe.style.color = root.getPropertyValue(v).trim();
        return getComputedStyle(probe).color;
      };
      const bg = resolve('--admin-white');
      setRatios({ body: contrast(resolve('--admin-gray-800'), bg), title: contrast(resolve('--admin-gray-700'), bg) });
      probe.remove();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const K = { placement, maxWidth, size, hoverOpens, hoverDelay };
  const fmt = (r: number | null) => (r == null ? '—' : `${r.toFixed(2)}:1 ${r >= 4.5 ? '✓ AA' : '✗ below 4.5'}`);

  return (
    <>
      {/* ── knobs ── */}
      <div className={styles.knobs} role="group" aria-label="Badge knobs">
        <label>
          Placement
          <select value={placement} onChange={(e) => setPlacement(e.target.value as HelpPlacement)}>
            <option value="auto">auto (flip when no room)</option>
            <option value="bottom">below</option>
            <option value="top">above</option>
          </select>
        </label>
        <label>
          Max width
          <select value={maxWidth} onChange={(e) => setMaxWidth(Number(e.target.value))}>
            <option value={240}>240</option>
            <option value={320}>320</option>
            <option value={400}>400</option>
          </select>
        </label>
        <label>
          Circle size
          <select value={size} onChange={(e) => setSize(Number(e.target.value) as HelpBadgeSize)}>
            <option value={16}>16 px</option>
            <option value={20}>20 px</option>
            <option value={24}>24 px</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={hoverOpens} onChange={(e) => setHoverOpens(e.target.checked)} /> Hover opens
        </label>
        <label>
          Hover delay
          <select value={hoverDelay} onChange={(e) => setHoverDelay(Number(e.target.value))} disabled={!hoverOpens}>
            <option value={0}>0 ms</option>
            <option value={150}>150 ms</option>
            <option value={300}>300 ms</option>
          </select>
        </label>
        <span className={styles.ratio}>
          Contrast on white — body {fmt(ratios.body)} · title {fmt(ratios.title)}
        </span>
      </div>

      {/* ── contexts ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Where it sits</h2>
        <p className={sg.sectionNote}>
          The same badge in the four places it will actually live. Every one reads its copy from{' '}
          <code>help.tsx</code>.
        </p>
        <div className={sg.specimenGrid}>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>After a form label</div>
            <FormPanel title="Publish">
              <div className={styles.field}>
                <label htmlFor="hs-oncal">
                  On the calendar <HelpBadge id="calendar.on-calendar" {...K} />
                </label>
                <input id="hs-oncal" type="checkbox" defaultChecked />
              </div>
              <div className={styles.field}>
                <label htmlFor="hs-promo">
                  Promote to homepage <HelpBadge id="calendar.promote" {...K} />
                </label>
                <input id="hs-promo" type="checkbox" />
              </div>
            </FormPanel>
          </div>

          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>In a table header</div>
            <table className={cal.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>
                    Status <HelpBadge id="calendar.status" {...K} />
                  </th>
                  <th className={cal.goingHead}>
                    Going <HelpBadge id="calendar.going" {...K} />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Fall Campout</td>
                  <td>
                    <span className={cal.statusCell}>
                      <span className={`${cal.pill} ${cal.pillLive}`}>S</span>
                    </span>
                  </td>
                  <td className={cal.goingCell}>23</td>
                </tr>
                <tr>
                  <td>PLC Meeting</td>
                  <td>
                    <span className={cal.statusCell}>
                      <span className={`${cal.pill} ${cal.pillDraft}`}>A</span>
                    </span>
                  </td>
                  <td className={cal.goingCell}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Mid-sentence in a lede</div>
            <p className={styles.lede}>
              Everything that happens on a date, whether or not it&rsquo;s on the troop calendar. The Status
              pills <HelpBadge id="calendar.status" {...K} /> say what each entry carries; Going{' '}
              <HelpBadge id="calendar.going" {...K} /> is the signup headcount.
            </p>
          </div>

          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>In a dialog title</div>
            <div className={`${dlg.dialog} ${sg.dialogStatic}`}>
              <div className={dlg.header}>
                <h3 className={dlg.title}>
                  Promote this entry? <HelpBadge id="calendar.promote" {...K} />
                </h3>
              </div>
              <div className={dlg.body}>It will appear in the homepage feed for the window below.</div>
              <div className={dlg.actions}>
                <Button variant="secondary" size="sm">
                  Cancel
                </Button>
                <Button size="sm">Promote</Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── behaviour ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Behaviour</h2>
        <div className={sg.specimenGrid}>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Long content</div>
            <p className={styles.lede}>
              About 150 words with a list and a link <HelpBadge id="sample.long" {...K} /> — does it grow,
              wrap, or scroll? Can the pointer travel onto it? Can Tab reach the link?
            </p>
          </div>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Keyboard</div>
            <p className={styles.lede}>
              Tab to the badge <HelpBadge id="sample.short" {...K} />, Enter or Space opens, Esc closes and
              focus comes back to the badge. Tab again moves on to the next thing:{' '}
              <Button size="sm" variant="secondary">
                Next thing
              </Button>
            </p>
          </div>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Right edge</div>
            <p className={`${styles.lede} ${styles.rightEdge}`}>
              The panel should slide left to stay on screen <HelpBadge id="sample.long" {...K} />
            </p>
          </div>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Two side by side</div>
            <p className={styles.lede}>
              Opening one <HelpBadge id="calendar.going" {...K} /> then the other{' '}
              <HelpBadge id="calendar.status" {...K} /> — the first closes.
            </p>
          </div>
        </div>
      </section>

      {/* ── the alternatives, for contrast ── */}
      <section className={sg.section}>
        <h2 className={sg.sectionHead}>The alternatives (Brad&rsquo;s ladder)</h2>
        <p className={sg.sectionNote}>
          Not everything belongs behind a badge. The rule: must know it <em>before</em> acting → visible; the
          screen&rsquo;s purpose in ≤ 2 sentences → lede; nothing here yet → empty state; the meaning of a symbol
          or column → badge beside it; a paragraph of &ldquo;how this section behaves&rdquo; → disclosure;
          otherwise hide it.
        </p>
        <div className={sg.specimenGrid}>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Inline field hint (aria-describedby)</div>
            <FormPanel title="Signup">
              <div className={styles.field}>
                <label htmlFor="hs-deadline">Deadline</label>
                <input id="hs-deadline" type="date" defaultValue="2026-10-04" aria-describedby="hs-deadline-hint" />
                <p id="hs-deadline-hint" className={styles.hint}>
                  Families can still edit their reply until this date. After it, only a leader can.
                </p>
              </div>
            </FormPanel>
          </div>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Collapsible &ldquo;How this works&rdquo;</div>
            <Disclosure />
          </div>
          <div className={sg.specimen}>
            <div className={sg.specimenLabel}>Empty state carries the instruction</div>
            <div className={styles.empty}>
              No signup on this entry. Not every event needs one — some you just come to. Enable one when
              families need to reply, pay, or claim a job.
            </div>
          </div>
        </div>
      </section>

      <section className={sg.section}>
        <h2 className={sg.sectionHead}>Bottom edge</h2>
        <p className={styles.lede}>
          Scroll so this is near the bottom of the window, then open it{' '}
          <HelpBadge id="sample.long" {...K} /> — with placement on auto the panel should flip above.
        </p>
      </section>
    </>
  );
}

/** The disclosure pattern, sample only — a useState toggle (D-070 bans <details>). */
function Disclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.disclosure}>
      <button type="button" className={styles.disclosureBtn} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> How roll call works
      </button>
      {open && (
        <div className={styles.disclosureBody}>
          <p>
            Tick everyone who is present. Scouts and adults are on separate tabs; guests appear under the household
            that brought them. The count on the calendar&rsquo;s R pill updates when you leave the tab.
          </p>
          <p>Credit for attendance posts to the ledger nightly, not the moment you tick the box.</p>
        </div>
      )}
    </div>
  );
}
