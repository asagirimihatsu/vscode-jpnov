/**
 * Snapshots the user's `jpnov.lint.*` settings into the flat, IPC-safe map the (vscode-free) server
 * resolves with `selectRules()`. Only ENABLED rules ride the wire — a `false` boolean or a `null`
 * threshold is simply omitted, since the server treats an absent key as "off" identically.
 *
 * Read at default (resource-less) scope: folder-level lint overrides are out of scope for Phase 1.
 */
import * as vscode from 'vscode';

import { allSettingKeys } from '#/shared/lint/catalog.ts';
import type { RawLintConfigWire } from '#/shared/protocol.ts';

export function buildLintSnapshot(): RawLintConfigWire {
  const config = vscode.workspace.getConfiguration();
  const snapshot: Record<string, boolean | number | string> = {};
  for (const key of allSettingKeys()) {
    const value = config.get(key);
    // Booleans matter when true, thresholds when a number, enums when a non-"off" string; everything
    // else stays off (omitted — the server treats an absent key as off).
    if (value === true || typeof value === 'number' || (typeof value === 'string' && value !== 'off')) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}
