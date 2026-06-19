/**
 * HTML escaping helpers for the jpnov -> HTML compiler. Pure + vscode-free.
 */

/**
 * Escapes the four characters that are unsafe in HTML text/attribute contexts:
 * `&`, `<`, `>`, and `"`. (`&` is replaced first so the entities it introduces are
 * not double-escaped.)
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Neutralizes a string for safe inclusion inside an HTML comment body
 * (`<!-- ... -->`). The double-hyphen `--` is illegal inside comments (it can close
 * the comment early or trip parsers), so it is broken with a space (`- -`); a stray
 * `>` is also defused to keep the output well-formed. The text is otherwise left
 * verbatim (comments are not HTML-escaped).
 */
export function escapeComment(s: string): string {
  return s.replace(/--/g, '- -').replace(/>/g, '&gt;');
}
