/**
 * Per-root narration vocabulary (cast + coined keywords), fed by the client's
 * `jpnov.highlight.*` settings pushes and consumed by the semantic-tokens recognizer.
 *
 * The store is the SINGLE source of per-root vocabulary state: `apply()` swaps the whole
 * snapshot (replacement semantics — a root absent from the pushed map has no vocabulary),
 * and `recognizerFor()` routes a document to its owning root by longest-prefix match over
 * the store's own keys. Recognizers are built lazily per entry and memoized on it, so a
 * fresh `apply()` invalidates every cache by construction — no cross-push identity checks.
 *
 * Normalization lives HERE and only here: the wire is untrusted (settings JSON can hold
 * anything), so non-string and empty items are dropped and duplicates keep first-seen
 * order — bad items never reject the rest ("空項目と重複は自動的に無視されます").
 *
 * vscode-free true leaf: value imports are limited to the recognizer and the URI string
 * helpers; the LSP `Connection` is only ever a type, so plain `node --test` can load this
 * module (and its test) without a resolver hook.
 */
import { createRecognizer } from './recognizer.ts';
import { normalizeRootUri } from '../fsUri.ts';

import type { Connection } from 'vscode-languageserver/node';
import type { HighlightChangedParams, HighlightVocabulary, HighlightVocabularyMap } from '#/shared/protocol.ts';
import type { Recognizer } from './recognizer.ts';

interface StoreEntry {
  readonly vocab: HighlightVocabulary;
  /** Lazily built on first {@link HighlightStore.recognizerFor} hit; dies with the entry. */
  recognizer?: Recognizer | undefined;
}

export interface HighlightStore {
  /** Replaces the whole snapshot (`undefined` clears it, e.g. no initializationOptions). */
  apply(map: HighlightVocabularyMap | undefined): void;
  /** The recognizer for the root owning `docUri`, or `undefined` when it declares no vocabulary. */
  recognizerFor(docUri: string): Recognizer | undefined;
}

/**
 * Keeps non-empty strings, dedups first-seen, and drops everything else. The single
 * surviving home of the old config parser's "drop bad items, never reject the whole
 * config" semantics.
 */
function normalizeList(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && item !== '') {
      out.add(item);
    }
  }
  return [...out];
}

export function createHighlightStore(): HighlightStore {
  let entries = new Map<string, StoreEntry>();

  return {
    apply(map: HighlightVocabularyMap | undefined): void {
      const next = new Map<string, StoreEntry>();
      for (const [rawUri, vocab] of Object.entries(map ?? {})) {
        // Empty-listed roots still get an entry: a nested folder's (empty) vocabulary must
        // shadow its parent's under the longest-prefix routing below.
        next.set(normalizeRootUri(rawUri), {
          vocab: {
            characters: normalizeList((vocab as HighlightVocabulary | undefined)?.characters),
            keywords: normalizeList((vocab as HighlightVocabulary | undefined)?.keywords),
          },
        });
      }
      entries = next;
    },

    recognizerFor(docUri: string): Recognizer | undefined {
      let best: string | undefined;
      let bestEntry: StoreEntry | undefined;
      for (const [rootUri, entry] of entries) {
        if (docUri === rootUri || docUri.startsWith(`${rootUri}/`)) {
          if (best === undefined || rootUri.length > best.length) {
            best = rootUri;
            bestEntry = entry;
          }
        }
      }
      if (!bestEntry) {
        return undefined;
      }
      const { characters, keywords } = bestEntry.vocab;
      if (characters.length === 0 && keywords.length === 0) {
        return undefined;
      }
      bestEntry.recognizer ??= createRecognizer(characters, keywords);
      return bestEntry.recognizer;
    },
  };
}

/**
 * The `jpnov/highlightChanged` handler: swap the snapshot, then ask the client to re-pull
 * semantic tokens for every open editor so the recolour is immediate (no reload, no edit
 * needed) — same move the config-edit path used to make. Kept here (not inlined in
 * server.ts) so the refresh call is unit-testable; forgetting it would be the silent
 * "setting change does nothing until you touch the document" bug.
 */
export function handleHighlightChanged(
  connection: Connection,
  store: HighlightStore,
  params: HighlightChangedParams,
): void {
  store.apply(params.highlight);
  // LSP send: rejects only on a dead connection (nothing to recover) -> drop the promise.
  void connection.languages.semanticTokens.refresh();
}
