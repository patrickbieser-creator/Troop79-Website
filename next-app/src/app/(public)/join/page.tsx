import Link from 'next/link';
import shell from '../../_components/news-cards.module.css';
import styles from '../../_components/about-join.module.css';

export const metadata = {
  title: 'Join — Troop 79',
  description:
    'How to join Scout Troop 79 in Milwaukee, Wisconsin: visit a Sunday meeting, say hello, and register with Scouts America. Boys and girls ages 11–17 welcome.'
};

const JOIN_EMAIL = 'bsatroop79bg@gmail.com';
const MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=1572+E+Capitol+Drive%2C+Milwaukee%2C+WI';

const FAQ = [
  {
    q: 'Does my scout need any experience?',
    a: 'No. Plenty of our scouts joined without a single night of Cub Scouting. The program starts from the beginning, and older scouts do the teaching.'
  },
  {
    q: 'What does it cost?',
    a: 'There is an annual Scouts America registration fee, and individual outings have their own costs depending on the activity. Email us and we’ll walk you through the current numbers before you commit to anything.'
  },
  {
    q: 'Can parents stay?',
    a: 'Yes — we’re a family troop. Parents are welcome at every meeting, and many end up helping with campouts, driving, or the committee. Siblings scout side by side here.'
  },
  {
    q: 'Can we join partway through the year?',
    a: 'Any time. Advancement is self-paced, so a scout who joins in February isn’t behind anyone — they just start where they are.'
  }
];

export default function JoinPage() {
  return (
    <>
      <div className={shell.sectionHeader}>
        <span className={shell.sectionLabel}>Join Troop 79</span>
        <span className={shell.sectionDate}>Milwaukee, Wisconsin</span>
      </div>

      <main className={shell.mainContent}>
        <div className={styles.layout}>
          <div className={styles.main}>
            <h1 className={styles.pageHeadline}>Step one: just show up.</h1>
            <p className={styles.lede}>
              There&rsquo;s no application to fill out before you visit and
              nothing to buy. Joining Troop 79 starts with your family walking
              into a Sunday meeting and seeing whether it feels right.
            </p>

            <section aria-labelledby="how-it-works">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="how-it-works">How Joining Works</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>

              <ol className={styles.steps}>
                <li className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true" />
                  <div>
                    <h2 className={styles.stepTitle}>Visit a Sunday meeting</h2>
                    <p className={styles.stepBody}>
                      We meet most Sundays from 4:00 to 5:30 PM at Northwoods,{' '}
                      <a href={MAPS_URL} target="_blank" rel="noopener noreferrer">
                        1572 E Capitol Drive, Milwaukee
                      </a>
                      . Check the <Link href="/events">calendar</Link>{' '}
                      to confirm we&rsquo;re meeting that week, then walk in and
                      ask anyone for the Scoutmaster. Come once or come three
                      times — visiting is free and nobody will chase you with
                      paperwork.
                    </p>
                  </div>
                </li>
                <li className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true" />
                  <div>
                    <h2 className={styles.stepTitle}>Say hello</h2>
                    <p className={styles.stepBody}>
                      Questions before (or after) you visit? Email the troop at{' '}
                      <a href={`mailto:${JOIN_EMAIL}`}>{JOIN_EMAIL}</a> and a
                      real parent volunteer will get back to you.
                    </p>
                  </div>
                </li>
                <li className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true" />
                  <div>
                    <h2 className={styles.stepTitle}>Register with Scouts America</h2>
                    <p className={styles.stepBody}>
                      When your scout is ready to join, there&rsquo;s a short
                      application and an annual registration fee. Our leaders
                      will sit with you and walk through the paperwork — it
                      takes one evening, not a season.
                    </p>
                  </div>
                </li>
                <li className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true" />
                  <div>
                    <h2 className={styles.stepTitle}>Jump in</h2>
                    <p className={styles.stepBody}>
                      Get a handbook, meet your patrol, and start on the first
                      requirements. Every one your scout completes shows up on
                      the troop&rsquo;s{' '}
                      <Link href="/advancement">advancement tracker</Link>, so
                      your family can follow progress from day one.
                    </p>
                  </div>
                </li>
              </ol>
            </section>

            <section className={styles.proseSection} style={{ marginTop: 34 }} aria-labelledby="who-can-join">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="who-can-join">Who Can Join</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.prose}>
                <p>
                  Troop 79 welcomes <strong>boys and girls of all
                  backgrounds</strong>, generally ages 11 through 17. Younger
                  kids who are 10 and have finished fifth grade (or earned the
                  Arrow of Light) can join too. Not sure where your scout
                  fits? <a href={`mailto:${JOIN_EMAIL}`}>Ask us</a>{' '}
                  &mdash; we&rsquo;ll sort it out.
                </p>
              </div>
            </section>

            <section aria-labelledby="join-faq">
              <div className={shell.sectionDivider}>
                <span className={shell.divLabel} id="join-faq">Common Questions</span>
                <span className={shell.divRule} aria-hidden="true" />
              </div>
              <div className={styles.faq}>
                {FAQ.map((item) => (
                  <div key={item.q} className={styles.faqItem}>
                    <h3 className={styles.faqQ}>{item.q}</h3>
                    <p className={styles.faqA}>{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className={styles.ctaBanner}>
              <p className={styles.ctaHeadline}>Come say hi this Sunday.</p>
              <p className={styles.ctaSub}>
                4:00 PM at Northwoods, 1572 E Capitol Drive — or send a note
                and we&rsquo;ll save you a seat.
              </p>
              <div className={styles.ctaButtons}>
                <a href={`mailto:${JOIN_EMAIL}`} className={styles.btnPrimary}>
                  Email the Troop
                </a>
                <Link href="/events" className={styles.btnGhost}>
                  Check the Calendar
                </Link>
              </div>
            </div>
          </div>

          <aside className={styles.sidebar}>
            <div className={shell.sidebarModule}>
              <h3 className={shell.sidebarModuleTitle}>When &amp; Where</h3>
              <div className={styles.factCard}>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Day</span>
                  <span className={styles.factValue}>Most Sundays</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Time</span>
                  <span className={styles.factValue}>4:00&ndash;5:30&nbsp;PM</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Place</span>
                  <span className={styles.factValue}>
                    Northwoods
                    <br />
                    <a href={MAPS_URL} target="_blank" rel="noopener noreferrer">
                      1572 E Capitol Drive
                    </a>
                    <br />
                    Milwaukee, WI
                  </span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.factLabel}>Email</span>
                  <span className={styles.factValue}>
                    <a href={`mailto:${JOIN_EMAIL}`}>{JOIN_EMAIL}</a>
                  </span>
                </div>
              </div>
            </div>

            <div className={shell.sidebarModule}>
              <h3 className={shell.sidebarModuleTitle}>New Here?</h3>
              <p className={styles.sidebarNote}>
                Get to know the troop first — who we are, how scouts lead, and
                what a year with Troop 79 looks like.{' '}
                <Link href="/about">About the troop&nbsp;&rarr;</Link>
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
