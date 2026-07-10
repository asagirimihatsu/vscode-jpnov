/**
 * Snapshots the `jpnov.project.*` setting into the per-root map carried on
 * `jpnov/listBooks` / `jpnov/build`. Unlike the render snapshot (window-global,
 * renderConfig.ts), this setting is `scope: resource`, so the value is read PER
 * workspace folder — each folder can override it in its own `.vscode/settings.json`.
 * The raw relative string is forwarded as-is; containment validation and the silent
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
      outDir: c.get<string>('outDir', PROJECT_DEFAULT.outDir),
    };
  }
  return map;
}
