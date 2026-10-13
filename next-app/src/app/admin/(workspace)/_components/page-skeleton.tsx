import styles from './page-skeleton.module.css';

/**
 * Content-area loading skeleton for admin routes: a title bar, a lede line, a
 * toolbar bar and a few rows. Used by the `loading.tsx` files under
 * `(workspace)/`, `advancement/` and `finance/`; it renders inside the
 * workspace layout's <main>, so the section bar stays visible while a page
 * streams in. The blocks are hidden from assistive tech; the wrapper
 * is a labelled "Loading" status.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading">
      <div aria-hidden="true" className={styles.skeleton}>
        <div className={`${styles.block} ${styles.title}`} />
        <div className={`${styles.block} ${styles.lede}`} />
        <div className={`${styles.block} ${styles.bar}`} />
        <div className={styles.rows}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className={`${styles.block} ${styles.row}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
