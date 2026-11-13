import { describe, it, expect } from 'vitest';
import { isGitBashStartupCrash, runWithStartupRetry, type RunResult } from '../src/lib/git-bash-retry';

/**
 * scripts/backup-prod.mts runs refresh-local-from-prod.sh under Git Bash. Git Bash
 * sometimes dies before running anything (`add_item … errno 1`); a retry of the same
 * command goes through. Only that startup crash is retried — a real failure inside the
 * refresh script (which truncates local tables) must surface on the first try.
 */
const CRASH =
  '      0 [main] bash (50560) C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe: *** fatal error - add_item ("\\??\\C:\\Program Files\\Git", "/", ...) failed, errno 1';

const crashed: RunResult = { status: 3221225477, output: CRASH };
const ok: RunResult = { status: 0, output: '✓ refreshed' };
const realFailure: RunResult = { status: 1, output: 'psql: error: relation "people" does not exist' };

function scripted(results: RunResult[]) {
  const calls: number[] = [];
  const run = () => {
    calls.push(calls.length + 1);
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  return { run, calls };
}

const noSleep = () => {};

describe('isGitBashStartupCrash', () => {
  it('recognises the add_item startup crash', () => {
    expect(isGitBashStartupCrash(crashed)).toBe(true);
  });

  it('does not treat a script failure as a startup crash', () => {
    expect(isGitBashStartupCrash(realFailure)).toBe(false);
  });

  it('does not treat a success as a startup crash', () => {
    expect(isGitBashStartupCrash({ status: 0, output: 'add_item mentioned in passing' })).toBe(false);
  });
});

describe('runWithStartupRetry', () => {
  it('returns the first result when it succeeds', () => {
    const { run, calls } = scripted([ok]);
    runWithStartupRetry(run, { attempts: 3, sleep: noSleep });
    expect(calls.length).toBe(1);
  });

  it('retries a startup crash and returns the success', () => {
    const { run } = scripted([crashed, ok]);
    expect(runWithStartupRetry(run, { attempts: 3, sleep: noSleep }).result.status).toBe(0);
  });

  it('reports how many attempts it took', () => {
    const { run } = scripted([crashed, crashed, ok]);
    expect(runWithStartupRetry(run, { attempts: 3, sleep: noSleep }).attempts).toBe(3);
  });

  it('never retries a real failure', () => {
    const { run, calls } = scripted([realFailure, ok]);
    runWithStartupRetry(run, { attempts: 3, sleep: noSleep });
    expect(calls.length).toBe(1);
  });

  it('gives up after the attempt limit and returns the last crash', () => {
    const { run, calls } = scripted([crashed]);
    const { result } = runWithStartupRetry(run, { attempts: 3, sleep: noSleep });
    expect([calls.length, result.status]).toEqual([3, 3221225477]);
  });

  it('pauses between attempts', () => {
    const pauses: number[] = [];
    const { run } = scripted([crashed, crashed, ok]);
    runWithStartupRetry(run, { attempts: 3, delayMs: 2000, sleep: (ms) => pauses.push(ms) });
    expect(pauses).toEqual([2000, 2000]);
  });
});
