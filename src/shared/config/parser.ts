import type {
  DataConfigFormat,
  NovelConfigFormat,
  RawNovelConfig,
} from './types.ts';

/**
 * See also `activationEvents` in `package.json`, which must be kept in sync with
 * the recognized basenames below. The second tuple element is the precedence rank
 * (lower wins): json > js > ts > mjs > cjs.
 */
const FORMAT_BY_FILENAME = {
  'novel.jp.json': ['json', 0],
  'novel.jp.js': ['js', 1],
  'novel.jp.mjs': ['mjs', 2],
  'novel.jp.cjs': ['cjs', 3],
  'novel.jp.ts': ['ts', 4],
} as Record<string, [NovelConfigFormat, number] | undefined>;

/** Numeric file-type bit for a regular file (matches vscode's `FileType.File`). */
export const FILE_TYPE_FILE = 1;

export interface MatchedConfig {
  filename: string;
  format: NovelConfigFormat;
}

export function isDataFormat(format: NovelConfigFormat): format is DataConfigFormat {
  return format === 'json';
}

/**
 * Picks the highest-precedence config among directory `entries`.
 *
 * `entries` is `[basename, fileTypeMask][]`; `allowMask` is a numeric bitmask of the
 * file types to accept (e.g. {@link FILE_TYPE_FILE}). A NUMERIC mask is used here on
 * purpose so this module stays vscode-free — the client maps `vscode.FileType` to
 * these bits at the boundary.
 */
export function matchConfig(
  entries: [string, number][],
  allowMask: number,
): MatchedConfig | null {
  const best = {
    filename: '',
    priority: Number.MAX_SAFE_INTEGER,
    format: 'json' as NovelConfigFormat,
  };

  for (const [name, type] of entries) {
    if ((type & allowMask) === 0) {
      continue;
    }
    const entry = FORMAT_BY_FILENAME[name];
    if (entry && entry[1] < best.priority) {
      best.filename = name;
      best.priority = entry[1];
      best.format = entry[0];
    }
  }

  return best.filename ? { filename: best.filename, format: best.format } : null;
}

export function parseDataConfig(bytes: Uint8Array | ArrayBuffer): RawNovelConfig {
  const content = new TextDecoder('utf-8').decode(bytes);
  return initConfig(JSON.parse(content));
}

export function loadModuleConfig(mod: Record<string, unknown>): RawNovelConfig {
  return initConfig('default' in mod ? mod.default : mod);
}

/**
 * Validates an optional string list (characters / keywords): keeps non-empty strings, dedups
 * first-seen, and returns `undefined` when there is nothing usable — dropping bad items rather
 * than rejecting the whole config.
 */
function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && item !== '') {
      out.add(item);
    }
  }
  return out.size > 0 ? [...out] : undefined;
}

/**
 * Coerces an arbitrary parsed value into a {@link RawNovelConfig}. Only the highlighting
 * vocabulary survives; unknown keys — including the migrated `sourceDir`/`outDir`/
 * `avoidLineBreaks` — are silently dropped. Never throws; never rejects the whole object
 * for one bad field.
 */
export function initConfig(raw: unknown): RawNovelConfig {
  if (raw === null || typeof raw !== 'object') {
    return {};
  }
  const { characters, keywords } = raw as Record<string, unknown>;
  const result: RawNovelConfig = {};
  const castNames = normalizeStringList(characters);
  if (castNames) {
    result.characters = castNames;
  }
  const keyTerms = normalizeStringList(keywords);
  if (keyTerms) {
    result.keywords = keyTerms;
  }
  return result;
}
