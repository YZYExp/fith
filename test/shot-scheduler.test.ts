import { describe, it, expect } from 'vitest';
import { createShotScheduler } from '../src/backends/extension/shot-scheduler.js';

/** Virtual clock: delay() advances time synchronously and records the wait. */
function makeClock() {
  let t = 0;
  const delays: number[] = [];
  return {
    now: () => t,
    delay: async (ms: number) => {
      delays.push(ms);
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
    delays,
  };
}

describe('createShotScheduler', () => {
  it('spaces consecutive shots at least minGapMs apart', async () => {
    const clock = makeClock();
    const times: number[] = [];
    const shoot = createShotScheduler({
      capture: () => {
        times.push(clock.now());
        return Promise.resolve('shot' + times.length);
      },
      now: clock.now,
      delay: clock.delay,
      minGapMs: 520,
    });

    await shoot();
    await shoot();
    await shoot();

    // First shot fires immediately; each subsequent is a full gap later.
    expect(times).toEqual([0, 520, 1040]);
  });

  it('does not wait when enough time has already elapsed', async () => {
    const clock = makeClock();
    const times: number[] = [];
    const shoot = createShotScheduler({
      capture: () => {
        times.push(clock.now());
        return Promise.resolve('ok');
      },
      now: clock.now,
      delay: clock.delay,
      minGapMs: 520,
    });

    await shoot(); // t=0
    clock.advance(1000); // a full second of real time passes
    await shoot(); // no extra delay needed

    expect(times).toEqual([0, 1000]);
  });

  it('serializes concurrent callers in order (never races the rate limiter)', async () => {
    const clock = makeClock();
    const times: number[] = [];
    const shoot = createShotScheduler({
      capture: () => {
        const n = times.push(clock.now());
        return Promise.resolve('shot' + n);
      },
      now: clock.now,
      delay: clock.delay,
      minGapMs: 520,
    });

    const results = await Promise.all([shoot(), shoot(), shoot()]);

    expect(results).toEqual(['shot1', 'shot2', 'shot3']);
    expect(times).toEqual([0, 520, 1040]); // still spaced despite concurrent dispatch
  });

  it('retries with backoff after a failure and returns the eventual success', async () => {
    const clock = makeClock();
    let calls = 0;
    const shoot = createShotScheduler({
      capture: () => {
        calls++;
        return calls <= 2 ? Promise.reject(new Error('quota exceeded')) : Promise.resolve('ok');
      },
      now: clock.now,
      delay: clock.delay,
      minGapMs: 520,
      backoffMs: 300,
    });

    const r = await shoot();
    expect(r).toBe('ok');
    expect(calls).toBe(3);
    // Linear backoff waits (300, 600) must have been applied between attempts.
    expect(clock.delays).toContain(300);
    expect(clock.delays).toContain(600);
  });

  it('gives up and resolves null after maxAttempts failures', async () => {
    const clock = makeClock();
    let calls = 0;
    const shoot = createShotScheduler({
      capture: () => {
        calls++;
        return Promise.reject(new Error('quota exceeded'));
      },
      now: clock.now,
      delay: clock.delay,
      maxAttempts: 5,
    });

    const r = await shoot();
    expect(r).toBeNull();
    expect(calls).toBe(5);
  });

  it('keeps working after a fully-failed shot (chain not broken)', async () => {
    const clock = makeClock();
    let mode: 'fail' | 'ok' = 'fail';
    const shoot = createShotScheduler({
      capture: () => (mode === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve('recovered')),
      now: clock.now,
      delay: clock.delay,
      maxAttempts: 2,
    });

    expect(await shoot()).toBeNull(); // exhausts attempts
    mode = 'ok';
    expect(await shoot()).toBe('recovered'); // subsequent calls still resolve
  });
});
