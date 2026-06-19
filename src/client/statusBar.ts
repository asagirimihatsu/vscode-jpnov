/**
 * The single aggregated status-bar item (bottom-left, high priority).
 *
 * It folds together the latest `jpnov/configState` for every workspace root:
 *   - ANY root in `error` state -> red-cross item `$(error) Japanese Novel: <root> config error`
 *     (themeColor statusBarItem.errorForeground), clicking opens that config's uri,
 *     and the tooltip lists EVERY failing root + its message.
 *   - otherwise, if AT LEAST ONE root is `valid` (and none error) -> `$(book) Japanese Novel`.
 *   - otherwise (all absent/removed, or nothing reported) -> hidden.
 *
 * Exactly one item is created; it is `dispose()`d on extension deactivate.
 */
import * as vscode from 'vscode';

import type { ConfigState } from '#/shared/protocol.ts';

import { lastPathSegment } from './paths.ts';

/** A config error for one root: its message and the config uri to open on click. */
interface ConfigError {
  readonly message: string;
  readonly configUri: string;
}

/** What we remember per root to render the aggregate. */
interface RootStatus {
  readonly state: ConfigState;
  /** Present only for `error`. */
  readonly error?: ConfigError;
}

/** A root known to be in `error` state, with its error narrowed to non-optional. */
interface FailingRoot {
  readonly root: string;
  readonly error: ConfigError;
}

const ERROR_BG = new vscode.ThemeColor('statusBarItem.errorBackground');

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly states = new Map<string, RootStatus>();

  constructor() {
    // High priority keeps it pinned toward the left edge of the left-aligned group.
    this.item = vscode.window.createStatusBarItem(
      'jpnov.status',
      vscode.StatusBarAlignment.Left,
      1000,
    );
    this.item.name = 'Japanese Novel';
  }

  /**
   * Record the latest state for one root and re-render. `removed`/`absent` clears the
   * root from the aggregate (a removed root should stop contributing entirely).
   */
  update(root: string, state: ConfigState, error?: ConfigError): void {
    if (state === 'removed' || state === 'absent') {
      this.states.delete(root);
    } else {
      this.states.set(root, error === undefined ? { state } : { state, error });
    }
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  // --- internals ----------------------------------------------------------

  private render(): void {
    // Collect failing roots with a narrowed (non-optional `error`) shape so we never
    // need non-null assertions downstream.
    const failing: FailingRoot[] = [];
    for (const [root, status] of this.states) {
      if (status.state === 'error' && status.error !== undefined) {
        failing.push({ root, error: status.error });
      }
    }

    const first = failing[0];
    if (first !== undefined) {
      const firstRoot = lastPathSegment(first.root);
      this.item.text = `$(error) Japanese Novel: ${firstRoot} config error`;
      this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
      this.item.backgroundColor = ERROR_BG;
      // Click opens the (first) offending config so the user lands on the problem.
      this.item.command = {
        title: 'Open Japanese Novel config',
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(first.error.configUri)],
      };
      this.item.tooltip = this.buildTooltip(failing);
      this.item.show();
      return;
    }

    const anyValid = [...this.states.values()].some((s) => s.state === 'valid');
    if (anyValid) {
      this.item.text = '$(book) Japanese Novel';
      this.item.color = undefined;
      this.item.backgroundColor = undefined;
      this.item.command = undefined;
      this.item.tooltip = 'Japanese Novel: novel-jp config active';
      this.item.show();
      return;
    }

    this.item.hide();
  }

  private buildTooltip(failing: readonly FailingRoot[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Japanese Novel config errors**\n');
    for (const { root, error } of failing) {
      md.appendMarkdown(`\n- \`${lastPathSegment(root)}\`: ${error.message}`);
    }
    return md;
  }
}
