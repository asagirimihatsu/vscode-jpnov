/**
 * "Build" entries for the Run and Debug launch dropdown. That selector only hosts DEBUG
 * configurations and only renders once a `launch.json` exists, so we (a) seed a `launch.json` with
 * two entries ("Build selected as HTML/Text") via {@link ensureLaunchConfig}, and (b) register an
 * inline {@link vscode.DebugAdapter} that turns pressing ▶ on one into a build of the Books panel's
 * CURRENT checkbox selection — then immediately terminates the (otherwise empty) debug session. No
 * real debugging happens; this is purely to put a prominent build button where users look for "run
 * this project".
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
const BUILD_CONFIGS: readonly vscode.DebugConfiguration[] = [
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

/**
 * Seeds `.vscode/launch.json` with the two build entries the FIRST time a config-bearing workspace
 * has NO launch configuration at all — so the green-▶ dropdown shows them without the user authoring
 * a launch.json by hand (the dropdown only renders when a launch.json exists). It never touches an
 * existing launch.json, and a one-shot workspace-state flag means a user who deletes the file is not
 * re-nagged. No-op on fs failures (virtual/readonly workspaces) — the Books panel buttons still build.
 */
export async function ensureLaunchConfig(
  context: vscode.ExtensionContext,
  folderUri: vscode.Uri,
): Promise<void> {
  const SEED_KEY = 'jpnov.launchSeeded';
  if (context.workspaceState.get<boolean>(SEED_KEY) === true) {
    return;
  }
  const launch = vscode.workspace.getConfiguration('launch', folderUri);
  const configs = launch.get<readonly unknown[]>('configurations') ?? [];
  if (configs.length === 0) {
    try {
      await launch.update(
        'configurations',
        BUILD_CONFIGS.map((c) => ({ ...c })),
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      void vscode.window.showInformationMessage(
        'Japanese Novel: added “Build selected as HTML / Text” to the Run and Debug dropdown (.vscode/launch.json).',
      );
    } catch {
      // Virtual/readonly workspace: can't write launch.json. The Books panel buttons still build.
    }
  }
  await context.workspaceState.update(SEED_KEY, true);
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
