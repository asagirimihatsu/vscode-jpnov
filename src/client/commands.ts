/**
 * The single command boundary for the extension. Every `vscode.commands.registerCommand` call
 * goes through {@link command} so an UNEXPECTED throw out of a handler becomes ONE localized error
 * popup instead of a silently-dropped rejection (the extension host logs an unhandled rejection but
 * shows the user nothing).
 *
 * `run` may be synchronous (`void`) or asynchronous (`Promise<void>`); `await run()` awaits either,
 * so a returned promise's rejection is caught here rather than floating. Handlers that surface their
 * OWN granular popups (e.g. BooksView.buildSelected) catch-and-return without rethrowing, so this
 * wrapper only ever fires on a genuinely unexpected fault — no double popup.
 */
import * as vscode from 'vscode';

/**
 * Register `id` with a body shielded by one try/catch. On an unexpected throw, show a single
 * localized error notification; on success nothing extra happens.
 */
export function command(id: string, run: () => Promise<void> | void): vscode.Disposable {
  return vscode.commands.registerCommand(id, async () => {
    try {
      await run();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // The last-resort popup itself never rejects; void it so this catch can't re-throw.
      void vscode.window.showErrorMessage(vscode.l10n.t('Japanese Novel: {0}', m));
    }
  });
}
