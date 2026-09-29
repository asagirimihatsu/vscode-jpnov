/**
 * Appends `items` to `into` one by one: a spread call takes every item as an argument, and the
 * call stack bounds their number. Pure + vscode-free.
 */
export function append<T>(into: T[], items: Iterable<T>): void {
  for (const item of items) {
    into.push(item);
  }
}
