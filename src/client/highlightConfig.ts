/**
 * Assembles the per-folder `jpnov.highlight.*` snapshot the server's vocabulary store
 * consumes — the highlight twin of `projectConfig.ts` (per-folder assembly, NO parsing:
 * values go out verbatim and the server normalizes) and `lintConfig.ts` (seeded at
 * initialize, re-pushed on change).
 *
 * EVERY workspace folder gets an entry, empty arrays included: the map itself defines the
 * target roots (replacement semantics), and a nested folder's empty entry must shadow its
 * parent's vocabulary under the server's longest-prefix routing.
 */
import * as vscode from 'vscode';

import type { HighlightVocabularyMap } from '#/shared/protocol.ts';

export function buildHighlightSnapshot(): HighlightVocabularyMap {
  const map: Record<string, { characters: string[]; keywords: string[] }> = {};
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const c = vscode.workspace.getConfiguration('jpnov.highlight', folder.uri);
    map[folder.uri.toString()] = {
      characters: c.get<string[]>('characters', []),
      keywords: c.get<string[]>('keywords', []),
    };
  }
  return map;
}
