/**
 * Server-side error reporting: turn an unexpected failure into a localizable `jpnov/serverError`
 * notification so the CLIENT can surface it as an error popup.
 *
 * The forked server is vscode-free (no `vscode.window.showErrorMessage`), so it cannot show UI
 * itself. Instead it emits a {@link LocalizableMessage} the client renders via `renderMessage()`
 * -> `vscode.l10n.t()`. A {@link LocalizedError} already carries a code, so it passes through
 * unchanged; anything else is wrapped under `server.unexpected` with the raw (untranslatable)
 * detail text.
 *
 * vscode-free: the runtime `Connection` is reached only through {@link ServerContext}.
 */
import { LocalizedError } from '#/shared/messages.ts';
import { ServerErrorNotification } from '#/shared/protocol.ts';
import type { LocalizableMessage, ServerErrorParams } from '#/shared/protocol.ts';

import type { ServerContext } from './roots.ts';

/**
 * Reports an unexpected server error to the client as a `jpnov/serverError` notification. A
 * {@link LocalizedError} forwards its `.localized` code verbatim; any other value is wrapped as
 * `{ code: 'server.unexpected', args: [detail] }`.
 *
 * Best-effort and never-throwing: the underlying `sendNotification` only rejects on a dead
 * connection (nothing actionable from inside an error handler), so its promise is deliberately
 * `void`ed — this lets call sites invoke `reportError` from a synchronous `catch` without it
 * becoming a new floating-promise / throw source.
 */
export function reportError(ctx: ServerContext, err: unknown): void {
  const message: LocalizableMessage = err instanceof LocalizedError
    ? err.localized
    : { code: 'server.unexpected', args: [err instanceof Error ? err.message : String(err)] };
  // sendNotification rejects only if the connection is already gone; nothing to recover, and
  // reportError must stay throw-free for its synchronous-catch callers, so we drop the promise.
  void ctx.connection.sendNotification(ServerErrorNotification, { message } satisfies ServerErrorParams);
}
