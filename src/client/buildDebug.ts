/**
 * The inline DEBUG adapter behind the "Build" entries in the Run and Debug launch dropdown. That
 * selector only hosts DEBUG configurations, so pressing ▶ on a `jpnov-build` entry is turned into a
 * build of the Books panel's CURRENT checkbox selection, then the (otherwise empty) debug session
 * terminates immediately. No real debugging happens; this is purely to put a prominent build button
 * where users look for "run this project".
 *
 * {@link BUILD_CONFIGS} is the canonical pair of launch entries; the `Init Workspace` command
 * (initWorkspace.ts) writes them into a scaffolded `.vscode/launch.json`.
 *
 * The debug TYPE (`jpnov-build`) must ALSO be declared in package.json `contributes.debuggers`:
 * VS Code only lets an extension register an adapter factory for a type it contributes.
 */
import * as vscode from 'vscode';

import type { BuildFormat } from '#/shared/protocol.ts';

/** The debug type; must match `contributes.debuggers[].type` in package.json. */
const DEBUG_TYPE = 'jpnov-build';

/**
 * The two launch entries seeded into `launch.json`. `format` is read back by the adapter; the
 * `name`s are what show in the ▶ dropdown.
 */
export const BUILD_CONFIGS: readonly vscode.DebugConfiguration[] = [
  { type: DEBUG_TYPE, request: 'launch', name: 'Build selected as HTML', format: 'html' },
  { type: DEBUG_TYPE, request: 'launch', name: 'Build selected as Text', format: 'txt' },
];

/** What the launch entries drive — implemented by the Books panel. */
export interface BuildRunner {
  /** Build the currently-checked books to one format. */
  buildSelected(format: BuildFormat): Promise<void>;
}

/** Registers the inline adapter factory that runs a build when one of the launch entries starts. */
export function registerBuildDebugger(runner: BuildRunner): vscode.Disposable {
  const factory: vscode.DebugAdapterDescriptorFactory = {
    createDebugAdapterDescriptor(
      session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
      return new vscode.DebugAdapterInlineImplementation(new BuildAdapter(session, runner));
    },
  };
  return vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, factory);
}

/** The minimal subset of an inbound DAP request we read off the opaque message. */
interface DapRequest {
  readonly seq: number;
  readonly type: string;
  readonly command: string;
}

/**
 * A throwaway debug adapter: it speaks just enough Debug Adapter Protocol to start, run ONE build
 * on `launch`, then terminate. It never attaches to a program — `session.configuration.format`
 * picks the output format and the build itself is delegated to the {@link BuildRunner}.
 */
class BuildAdapter implements vscode.DebugAdapter {
  private readonly sendEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this.sendEmitter.event;
  private readonly session: vscode.DebugSession;
  private readonly runner: BuildRunner;

  constructor(session: vscode.DebugSession, runner: BuildRunner) {
    this.session = session;
    this.runner = runner;
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const req = message as Partial<DapRequest>;
    if (req.type !== 'request' || typeof req.command !== 'string' || typeof req.seq !== 'number') {
      return;
    }
    if (req.command === 'initialize') {
      // No special capabilities (and no configurationDone), so VS Code proceeds straight to launch.
      this.respond(req.command, req.seq, {});
      this.send({ seq: 0, type: 'event', event: 'initialized' });
    } else if (req.command === 'launch') {
      void this.runAndTerminate(req.command, req.seq);
    } else {
      // disconnect / threads / …: ack so the session can settle and close cleanly.
      this.respond(req.command, req.seq, {});
    }
  }

  dispose(): void {
    this.sendEmitter.dispose();
  }

  private async runAndTerminate(command: string, requestSeq: number): Promise<void> {
    const config = this.session.configuration as { readonly format?: unknown };
    const format: BuildFormat = config.format === 'txt' ? 'txt' : 'html';
    try {
      await this.runner.buildSelected(format);
    } finally {
      this.respond(command, requestSeq, {});
      this.send({ seq: 0, type: 'event', event: 'terminated' });
    }
  }

  private respond(command: string, requestSeq: number, body: object): void {
    this.send({ seq: 0, type: 'response', request_seq: requestSeq, success: true, command, body });
  }

  /** All outbound DAP messages funnel through here (the opaque `DebugProtocolMessage` is just `{}`). */
  private send(message: object): void {
    this.sendEmitter.fire(message);
  }
}
