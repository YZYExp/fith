/**
 * Rate-limited, serialized screenshot scheduler for the service worker.
 *
 * chrome.tabs.captureVisibleTab is quota-limited (~2 calls/sec) and throws once
 * the quota is exceeded. The content script fires many shots while tiling a
 * region through the viewport, so this scheduler:
 *   • serializes shots through a promise chain (concurrent callers never race
 *     the rate limiter),
 *   • spaces consecutive shots at least `minGapMs` apart,
 *   • retries a failed shot with linear backoff up to `maxAttempts`.
 *
 * All time/IO is injected (`now`, `delay`, `capture`) so the timing logic is
 * unit-testable with a virtual clock — no real browser, no real wall time.
 */
export interface ShotSchedulerOptions {
  /** Take one screenshot; rejects on quota/other errors. */
  capture: () => Promise<string>;
  /** Current time in ms. Defaults to Date.now. */
  now?: () => number;
  /** Sleep for ms. Defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
  /** Minimum gap between consecutive shots (ms). Default 520 (~under 2/sec). */
  minGapMs?: number;
  /** Attempts per shot before giving up. Default 5. */
  maxAttempts?: number;
  /** Backoff base (ms); attempt N waits backoffMs*(N+1) after a failure. Default 300. */
  backoffMs?: number;
}

/**
 * Returns a `shoot()` function: each call resolves to a screenshot data URL, or
 * null if every attempt failed. Calls are serialized and rate-limited as above.
 */
export function createShotScheduler(opts: ShotSchedulerOptions): () => Promise<string | null> {
  const now = opts.now ?? Date.now;
  const delay = opts.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minGapMs = opts.minGapMs ?? 520;
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = opts.backoffMs ?? 300;

  let chain: Promise<unknown> = Promise.resolve();
  // Seed so the very first shot isn't made to wait a full gap.
  let lastShot = now() - minGapMs;

  const doShoot = async (): Promise<string | null> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const wait = minGapMs - (now() - lastShot);
      if (wait > 0) await delay(wait);
      try {
        const url = await opts.capture();
        lastShot = now();
        return url;
      } catch {
        lastShot = now();
        await delay(backoffMs * (attempt + 1)); // linear backoff, then retry
      }
    }
    return null;
  };

  return () => {
    const next = chain.then(() => doShoot());
    chain = next.catch(() => {}); // keep the chain alive even if a shot rejects
    return next;
  };
}
