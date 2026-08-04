/**
 * EPUB 3 container assembly: one book → the member files of an OCF container (reflowable,
 * vertical-rl, right-to-left spine), plus the zip step the client runs. Spec:
 * https://www.w3.org/TR/epub-33/. Chapters map to spine files 1:1 (＃改ページ splits again
 * within a chapter); there is NO inter-chapter glue — every chapter junction is a page seam,
 * where the divider is suppressed by the same rule `chapterGlue` applies at ［＃改ページ］.
 *
 * `epubMembers` is pure and deterministic given `modified` (the injected build timestamp):
 * the identifier derives from `outRel`, the same identity the output path keys on, so
 * rebuilding a book keeps its identity and readers treat it as an update, not a new book.
 * Pure + vscode-free (fflate does the DEFLATE work; the `mimetype` member is added at zip
 * time, STORED and first, as OCF requires).
 */
import { createHash } from 'node:crypto';
import { strToU8, zipSync, type Zippable } from 'fflate';

import type { JpbookMeta } from './book/jpbook.ts';
import { applyAutoTcy } from './compiler/autoTcy.ts';
import { reflowStylesheet } from './compiler/css.ts';
import type { BookInput } from './compiler/document.ts';
import { escapeHtml } from './compiler/escape.ts';
import { buildRows } from './compiler/layout.ts';
import { reflowDocument, reflowSegments } from './compiler/reflow.ts';
import { tokenize } from './compiler/tokenizer.ts';
import type { AutoTcyMode, KinsokuMode } from './config/types.ts';
import type { EpubMember } from './protocol.ts';

/**
 * `urn:uuid:` identity derived from the book's output stem: sha-256 of a fixed seed, first
 * 16 bytes, with the version nibble stamped 8 (RFC 9562 UUIDv8 — custom algorithm) and the
 * 10xx variant. Deterministic, so every rebuild is the SAME publication to a reading system.
 */
function bookIdentifier(outRel: string): string {
  const digest = createHash('sha256').update(`jpnov:${outRel}`).digest();
  const b = Uint8Array.from(digest.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const parts = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)];
  return `urn:uuid:${parts.join('-')}`;
}

/** The chapter file's own name (no directories, no `.jpnov`) — the nav label of last resort. */
function chapterStem(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  return base.endsWith('.jpnov') ? base.slice(0, -'.jpnov'.length) : base;
}

const CONTAINER_XML =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
  '</container>';

/** One spine-level content document, in spine order. */
interface SpineDoc {
  /** Manifest id and file stem — `ch001` for a chapter's first file, `ch001-2` onward for its splits. */
  readonly id: string;
  /** Href relative to the OPF/nav location (`OEBPS/`). */
  readonly href: string;
  readonly title: string;
  readonly body: string;
}

/** One `.jpbook` chapter for the nav: its first spine file and its label. */
interface NavChapter {
  readonly href: string;
  readonly label: string;
}

export function epubMembers(opts: {
  readonly book: BookInput;
  readonly meta: JpbookMeta;
  /** The book's output stem (`jpbookOutRel`) — identity for dc:identifier and the title fallback. */
  readonly outRel: string;
  readonly kinsoku: KinsokuMode;
  readonly autoTcy: AutoTcyMode;
  /** Build timestamp for `dcterms:modified`, CCYY-MM-DDThh:mm:ssZ — injected (the determinism seam). */
  readonly modified: string;
}): EpubMember[] {
  const title = opts.meta.title ?? chapterStem(opts.outRel);
  const used = new Set<string>();
  const docs: SpineDoc[] = [];
  const navChapters: NavChapter[] = [];

  opts.book.files.forEach((file, index) => {
    const rows = buildRows(tokenize(applyAutoTcy(file.src, opts.autoTcy)));
    const segments = reflowSegments(rows, used);
    if (segments.length === 0) {
      return; // an empty chapter source contributes no spine file and no nav row
    }
    const stem = `ch${String(index + 1).padStart(3, '0')}`;
    const label = segments.find((s) => s.heading !== null)?.heading ?? chapterStem(file.name);
    segments.forEach((seg, si) => {
      const id = si === 0 ? stem : `${stem}-${String(si + 1)}`;
      docs.push({ id, href: `text/${id}.xhtml`, title: seg.heading ?? label, body: seg.body });
      if (si === 0) {
        navChapters.push({ href: `text/${id}.xhtml`, label });
      }
    });
  });
  if (docs.length === 0) {
    // A book whose chapters are all empty still needs a non-empty spine to be an EPUB at all.
    docs.push({ id: 'ch001', href: 'text/ch001.xhtml', title, body: '<p><br/></p>' });
    navChapters.push({ href: 'text/ch001.xhtml', label: title });
  }

  const creator = opts.meta.author === undefined
    ? ''
    : `<dc:creator>${escapeHtml(opts.meta.author)}</dc:creator>`;
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles.css" media-type="text/css"/>',
    ...docs.map((d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`),
  ].join('');
  const spine = docs.map((d) => `<itemref idref="${d.id}"/>`).join('');
  const opf =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="ja">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:identifier id="pub-id">${bookIdentifier(opts.outRel)}</dc:identifier>` +
    `<dc:title>${escapeHtml(title)}</dc:title>` +
    '<dc:language>ja</dc:language>' +
    creator +
    `<meta property="dcterms:modified">${escapeHtml(opts.modified)}</meta>` +
    '</metadata>' +
    `<manifest>${manifest}</manifest>` +
    // 右開き: right-to-left page progression is what makes a vertical-rl book turn correctly.
    `<spine page-progression-direction="rtl">${spine}</spine>` +
    '</package>';

  const navList = navChapters
    .map((c) => `<li><a href="${c.href}">${escapeHtml(c.label)}</a></li>`)
    .join('');
  const nav =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">' +
    '<head><title>目次</title></head>' +
    `<body><nav epub:type="toc"><h1>目次</h1><ol>${navList}</ol></nav></body></html>`;

  return [
    { name: 'META-INF/container.xml', content: CONTAINER_XML },
    { name: 'OEBPS/package.opf', content: opf },
    { name: 'OEBPS/nav.xhtml', content: nav },
    { name: 'OEBPS/styles.css', content: reflowStylesheet(opts.kinsoku, [...used].sort()) },
    ...docs.map((d) => ({
      name: `OEBPS/${d.href}`,
      content: reflowDocument(d.title, d.body, '../styles.css'),
    })),
  ];
}

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
