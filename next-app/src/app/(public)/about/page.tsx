import Link from 'next/link';
import shell from '../../_components/news-cards.module.css';
import styles from '../../_components/about-join.module.css';

export const metadata = {
  title: 'About — Troop 79',
  description:
    'Scout Troop 79 is a family Scouts America troop in Milwaukee, Wisconsin — about 30 scouts and 25 families meeting Sundays on the East Side.'
};

const STATS = [
  { num: '2022', label: 'Founded' },
  { num: '~30', label: 'Scouts' },
  { num: '25', label: 'Families' },
  { num: '10', label: 'Adult Leaders' }
];

export default function AboutPage() {
  return (
    <>
      <div className={shell.sectionHeader}>
        <span className={shell.sectionLabel}>About the Troop</span>
        <span className={shell.sectionDate}>Milwaukee, Wisconsin</span>
      </div>

      <main className={shell.mainContent}>
        <div className={styles.layout}>
          <div className={styles.main}>
            <h1 className={styles.pageHeadline}>
              A family troop, growing up together.
            </h1>
            <p className={styles.lede}>
              Scout Troop 79 is a family Scouts America troop on Milwaukee&rsquo;s
              East Side — about thirty scouts, twenty-five families, and the
              adult volunteers who keep it all moving. We welcome boys and girls
              of all backgrounds, and most of us are learning this together.
            </p>

            <div className={styles.statStrip}>
              {STATS.map((s) => (
                <div key={s.label} className={styles.statCell}>
                  <div className={styles.statNum}>{s.num}</div>
                  <div className={styles.statLabel}>{s.label}</div>
                </div>
              ))}
            </div>

            <section className={styles.proseSection} aria-labelledby="who-we-are">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="who-we-are">Who We Are</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.prose}>
                <p>
                  Troop 79 was founded in 2022 and is chartered through Scouts
                  America. We&rsquo;re a <strong>family troop</strong>: siblings
                  scout side by side, parents pitch in, and whole families show
                  up for campouts and service days. Some of our scouts arrived
                  with years of Cub Scouting behind them, but plenty walked in never
                  having tied anything more ambitious than a shoelace.
                </p>
                <p>
                  What holds it together is the Sunday meeting — a
                  ninety-minute stretch of skills, ceremonies, games, and the
                  occasional controlled chaos that scouting is built on.
                </p>
              </div>
            </section>

            <section className={styles.proseSection} aria-labelledby="scout-led">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="scout-led">Scout-Led, Adult-Supported</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.prose}>
                <p>
                  Scouts are organized into patrols, plan the meetings, and —
                  this is the part that surprises new families — are deeply involved in doing the
                  teaching. Older scouts lead skill instruction at
                  meetings, from knots and first aid to cooking and navigation.
                  Adults stay close, mentor, and handle the things that need a
                  more experienced hand.
                </p>
              </div>
            </section>

            <section className={styles.proseSection} aria-labelledby="what-we-do">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="what-we-do">What We Do</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.prose}>
                <p>
                  Between Sunday meetings the troop calendar fills with
                  campouts, day outings, service projects, and fundraisers.
                  Scouts work through the ranks — Scout to Eagle — and earn
                  merit badges along the way, taught by troop
                  adults, and outside experts. The{' '}
                  <Link href="/events">troop calendar</Link>{' '}
                  always has what&rsquo;s coming next.
                </p>
              </div>
            </section>

            <section className={styles.proseSection} aria-labelledby="advancement-open">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="advancement-open">Advancement, In the Open</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.prose}>
                <p>
                  This website is more than a newsletter. Every requirement a
                  scout completes is recorded here, and families can follow
                  progress on the <Link href="/advancement">advancement
                  tracker</Link> and the <Link href="/merit-badges">merit badge
                  catalog</Link> any time — no waiting for a court of honor to
                  find out how close a rank is.
                </p>
              </div>
            </section>

            <div className={styles.ctaBanner}>
              <p className={styles.ctaHeadline}>Thinking about joining?</p>
              <p className={styles.ctaSub}>
                Your family&rsquo;s first Sunday meeting is step one — no
                experience or commitment required.
              </p>
              <div className={styles.ctaButtons}>
                <Link href="/join" className={styles.btnPrimary}>
                  How to Join Troop 79
                </Link>
              </div>
            </div>
          </div>

          <aside className={styles.sidebar}>
            <div className={shell.sidebarModule}>
              <h3 className={shell.sidebarModuleTitle}>At a Glance</h3>
              <div className={styles.factCard}>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Chartered</span>
                  <span className={styles.factValue}>Scouts America</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Who</span>
                  <span className={styles.factValue}>Boys &amp; girls, ages 11&ndash;17</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Meetings</span>
                  <span className={styles.factValue}>Sundays, 4:00&ndash;5:30&nbsp;PM</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Where</span>
                  <span className={styles.factValue}>
                    Northwoods
                    <br />
                    1572 E Capitol Drive
                    <br />
                    Shorewood, WI
                  </span>
                </div>
              </div>
            </div>

            <div className={shell.sidebarModule}>
              <h3 className={shell.sidebarModuleTitle}>Leadership</h3>
              <p className={styles.sidebarNote}>
                <strong>Mindy Stollenwerk</strong>, Scoutmaster, leads the adult
                team, and <strong>Jack Kosmoski</strong>, Committee Chair, leads
                the parent committee behind it. Reach the troop at{' '}
                <a href="mailto:bsatroop79bg@gmail.com">bsatroop79bg@gmail.com</a>.
              </p>
            </div>

            <div className={shell.sidebarModule}>
              <h3 className={shell.sidebarModuleTitle}>Come Visit</h3>
              <p className={styles.sidebarNote}>
                The best way to meet Troop 79 is in person — drop in on any
                Sunday meeting. <Link href="/join">Here&rsquo;s how joining
                works&nbsp;&rarr;</Link>
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
