import { readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

/** Page links used by the protocol and the optional backlink reader. */
export function markdownLinks(markdown) {
  const links = [];
  let fence = null;
  for (const [index, original] of markdown.split('\n').entries()) {
    const marker = original.match(/^\s*(?:[-*+]\s+)?(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const line = original.replace(/(`+).*?\1/g, '');
    for (const match of line.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|[^\]]+)?\]\]/g)) {
      const file = match[1].trim();
      links.push({ file: file.endsWith('.md') ? file : `${file}.md`, anchor: match[2], line: index + 1, wiki: true });
    }
    for (const match of line.matchAll(/(?<!!)\[[^\]]*\]\(([^)#\s]+)(?:#([^\s)]+))?\)/g)) {
      links.push({ file: match[1], anchor: match[2], line: index + 1, wiki: false });
    }
  }
  return links;
}

/** Evidence outside the vault is referenced, not fetched or attested by validation. */
export function isVaultNote(file) {
  return !/^(?:[a-z][a-z\d+.-]*:|\/|\.\.\/)/i.test(file)
    && !file.split('/').includes('..') && file.endsWith('.md');
}

/** Wiki page names are vault-wide; ordinary Markdown paths are relative to their source note. */
export function resolveNoteLink(link, source, notes) {
  let file = link.file;
  try { file = decodeURIComponent(file); } catch { /* Keep a literal percent sign in a filename. */ }
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(file) || !file.endsWith('.md')) return { external: true };
  const relative = !link.wiki || /^\.\.?\//.test(file);
  const target = posix.normalize(relative ? posix.join(posix.dirname(source), file) : file);
  if (!isVaultNote(target)) return { external: true };
  const matches = link.wiki && !file.includes('/')
    ? notes.filter((note) => posix.basename(note) === target)
    : notes.filter((note) => note === target);
  return { target, matches };
}

/** Index note names without reading journals into resume context or sync payloads. */
export async function listVaultNotes(root) {
  const notes = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = [relative, entry.name].filter(Boolean).join('/');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) notes.push(file);
    }
  }
  await walk();
  return notes.sort();
}
