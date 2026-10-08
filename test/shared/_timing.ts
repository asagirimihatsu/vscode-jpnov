/** The guard of a path that once grew with the square of its input. */
import assert from 'node:assert/strict';

/** Runs `fn` and fails when it takes 2 seconds or longer: generous for a linear pass, far below a quadratic one. */
export function inLinearTime<T>(message: string, fn: () => T): T {
  const started = performance.now();
  const out = fn();
  assert.ok(performance.now() - started < 2_000, message);
  return out;
}
