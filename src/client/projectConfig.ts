/**
 * Snapshots the `jpnov.project.*` settings into the per-root map carried on
 * `jpnov/listBooks` / `jpnov/build`. Unlike the render snapshot (window-global,
 * renderConfig.ts), these settings are `scope: resource`, so the value is read PER
 * workspace folder — each folder can override them in its own `.vscode/settings.json`.
 * Raw relative strings are forwarded as-is; containment validation and the silent
 * default fallback are the server's job (`resolveProjectDir` in src/server/build.ts).
 */
import * as vscode from 'vscode';

import { PROJECT_DEFAULT } from '#/shared/config/types.ts';
import type { ProjectDirs } from '#/shared/protocol.ts';

export function buildProjectDirs(): Record<string, ProjectDirs> {
  const map: Record<string, ProjectDirs> = {};
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const c = vscode.workspace.getConfiguration('jpnov.project', folder.uri);
    map[folder.uri.toString()] = {
      sourceDir: c.get<string>('sourceDir', PROJECT_DEFAULT.sourceDir),
      outDir: c.get<string>('outDir', PROJECT_DEFAULT.outDir),
    };
  }
  return map;
}
