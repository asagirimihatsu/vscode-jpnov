/**
 * The OCF zip step the client runs on an EPUB's member files. A module of its own so the
 * host bundle pulls in fflate alone — `epub.ts` would drag the layout engine along.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

import type { EpubMember } from './epub.ts';

/**
 * Zips the members into the OCF container. The `mimetype` member is prepended here — STORED
 * (never compressed) and FIRST, as OCF requires — so it is a constant of the format, not
 * wire payload. Insertion order is the archive order.
 */
export function ocfZip(members: readonly EpubMember[]): Uint8Array {
  const record: Zippable = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] };
  for (const m of members) {
    record[m.name] = strToU8(m.content);
  }
  return zipSync(record);
}
