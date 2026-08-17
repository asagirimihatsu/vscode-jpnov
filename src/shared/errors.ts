/** The display string of a thrown value: an `Error`'s message, anything else via `String()`. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
