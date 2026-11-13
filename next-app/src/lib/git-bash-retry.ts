/**
 * Git Bash on this machine sometimes dies at startup, before it runs anything:
 *   bash.exe: *** fatal error - add_item ("\??\C:\Program Files\Git", "/", ...) failed, errno 1
 * Running the same command again goes through. scripts/backup-prod.mts uses this to retry
 * that crash, and only that crash: a real failure inside the refresh script (which truncates
 * local tables) is returned on the first try so it surfaces in backup.log.
 */
export type RunResult = { status: number | null; output: string };

const STARTUP_CRASH = /fatal error - add_item \(.*\) failed/;

export function isGitBashStartupCrash(r: RunResult): boolean {
  return r.status !== 0 && STARTUP_CRASH.test(r.output);
}

export function runWithStartupRetry(
  run: () => RunResult,
  opts: { attempts?: number; delayMs?: number; sleep: (ms: number) => void },
): { result: RunResult; attempts: number } {
  const limit = Math.max(1, opts.attempts ?? 3);
  const delay = opts.delayMs ?? 2000;
  let result = run();
  let attempts = 1;
  while (attempts < limit && isGitBashStartupCrash(result)) {
    opts.sleep(delay);
    result = run();
    attempts++;
  }
  return { result, attempts };
}
