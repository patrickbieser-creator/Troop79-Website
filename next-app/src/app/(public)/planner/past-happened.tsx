/**
 * A past meeting's "What happened" (Patrick, 2026-11-09): roll call and the advancement signed off that day, below the
 * plan as it stood that night. Requirement sign-offs are dated, not linked to the meeting, so one signed off at
 * another event the same day lands here too; the note says so.
 */
import type { Happened } from '@/lib/past-meeting';
import h from './past-happened.module.css';

export function PastHappened({ happened, dateLabel }: { happened: Happened; dateLabel: string }) {
  const { attended, signedOff, earned } = happened;
  const offPlan = signedOff.filter((r) => !r.planned).length;
  return (
    <section className={h.card} aria-labelledby="past-happened">
      <h2 id="past-happened" className={h.title}>
        What happened
      </h2>

      <div className={h.block}>
        <h3 className={h.head}>
          Roll call · {attended.scouts.length} scouts, {attended.adults.length} adults
        </h3>
        {attended.scouts.length + attended.adults.length === 0 ? (
          <p className={h.muted}>No roll call was taken.</p>
        ) : (
          <>
            <p className={h.names}>
              <span className={h.label}>Scouts</span> {attended.scouts.join(', ') || 'none'}
            </p>
            <p className={h.names}>
              <span className={h.label}>Adults</span> {attended.adults.join(', ') || 'none'}
            </p>
          </>
        )}
      </div>

      {earned.length ? (
        <div className={h.block}>
          <h3 className={h.head}>Earned on {dateLabel}</h3>
          <ul className={h.list}>
            {earned.map((e) => (
              <li key={e.label}>
                <strong>{e.label}</strong> · {e.names.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={h.block}>
        <h3 className={h.head}>
          Signed off on {dateLabel} · {signedOff.length} requirements
          {offPlan ? ` (${offPlan} not on the plan)` : ''}
        </h3>
        {signedOff.length === 0 ? (
          <p className={h.muted}>Nothing recorded for that day yet.</p>
        ) : (
          <ul className={h.list}>
            {signedOff.map((r) => (
              <li key={r.key}>
                <strong>{r.label}</strong>
                {r.planned ? null : <span className={h.offPlan}>Not on the plan</span>} · {r.names.join(', ')}
              </li>
            ))}
          </ul>
        )}
        <p className={h.muted}>Sign-offs are matched by date, so anything recorded for another event that day shows here too.</p>
      </div>
    </section>
  );
}
