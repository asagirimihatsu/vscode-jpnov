/**
 * Appends `items` to `into` one by one: a spread call takes every item as an argument, and the
 * call stack bounds their number. Pure + vscode-free.
 */
export function append<T>(into: T[], items: Iterable<T>): void {
  for (const item of items) {
    into.push(item);
  }
}

/** The first index of `sorted` whose value is above `value`. */
export function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? Infinity) <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
