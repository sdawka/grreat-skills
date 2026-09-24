#!/usr/bin/env node
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CANONICAL_FILES, parseManifest, parseRecords, PROTOCOL_VERSION, validateFocus, validateWorkspace } from './validator.mjs';
import { readCanonicalFiles } from './sync.mjs';
import { listVaultNotes, markdownLinks, resolveNoteLink } from './links.mjs';

const templates = fileURLToPath(new URL('./assets/project/', import.meta.url));
const execute = promisify(execFile);

/**
 * Initialize once. Existing complete records are reused; partial records need inspection.
 * @param {{ directory?: string, title?: string }} [options]
 */
export async function initializeProject({ directory = 'docs/grreat', title } = {}) {
  if (typeof title !== 'string' || !title.trim() || /[\r\n<>\[\]]/.test(title)) throw new Error('Provide a single-line project title without links or HTML markup.');
  const root = resolve(directory);
  try {
    await lstat(root);
    const files = await readCanonicalFiles(root).catch(() => null);
    if (files && validateWorkspace(files).valid) return { status: 'existing', directory: root };
    throw new Error('The directory contains an existing or partial record. Inspect it instead of overwriting it.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(root), { recursive: true });
  const staging = await mkdtemp(join(dirname(root), '.grreat-init-'));
  try {
    for (const file of await readdir(templates)) {
      const text = (await readFile(join(templates, file), 'utf8')).replaceAll('{{project_title}}', () => title.trim());
      await writeFile(join(staging, file), text, { flag: 'wx' });
    }
    await mkdir(join(staging, 'journals'));
    // Decision history stays compatible with the original docs/grreat protocol.
    try { await writeFile(join(dirname(root), 'decision_log.md'), '# Decision log\n', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await rename(staging, root);
    return { status: 'created', directory: root };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Read Git metadata without changing the index or including diffs and file contents. */
async function gitSnapshot(directory) {
  const heading = '\n## Current Git snapshot (read-only)';
  try {
    const { stdout } = await execute('git', [
      '--no-optional-locks', '-c', 'core.fsmonitor=false', 'status',
      '--porcelain=v2', '--branch', '--untracked-files=normal', '-z',
    ], { cwd: directory, encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024 });
    const entries = stdout.split('\0');
    const branch = entries.find((entry) => entry.startsWith('# branch.head '))?.slice(14);
    const revision = entries.find((entry) => entry.startsWith('# branch.oid '))?.slice(13);
    if (!branch || !revision) throw new Error('No Git branch metadata');
    let tracked = 0;
    let untracked = 0;
    let conflicts = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (/^[12u] /.test(entry)) tracked += 1;
      if (entry.startsWith('u ')) conflicts += 1;
      if (entry.startsWith('? ')) untracked += 1;
      if (entry.startsWith('2 ')) index += 1; // Rename source names are separate NUL-delimited fields.
    }
    return [
      heading,
      `- Branch: ${branch.replace(/[\r\n\t]/g, ' ').slice(0, 120)}`,
      `- Revision: ${revision === '(initial)' ? 'No commits yet' : revision.slice(0, 64)}`,
      `- Working tree: ${tracked || untracked ? 'dirty' : 'clean'} (${tracked} tracked changes, ${untracked} untracked paths, ${conflicts} conflicts).`,
      '- Compare this snapshot with the state recorded beside the evidence. Changes, including note edits, do not by themselves invalidate earlier checks.',
    ];
  } catch {
    return [heading, '- Unavailable: this directory may not be in a Git repository, or Git could not be read within the time/output limits. Continue with the project files and recorded evidence.'];
  }
}

/** Only the selected record bodies and a compact current Git snapshot enter resume context. */
export async function resumeContext(directory = 'docs/grreat') {
  const root = resolve(directory);
  const files = await readCanonicalFiles(root);
  const manifest = parseManifest(files['README.md']);
  if (manifest.version !== PROTOCOL_VERSION) throw new Error(`Unsupported manifest version: ${manifest.version}`);
  if (!manifest.active.length) throw new Error('The manifest has no active context records.');
  const output = [`GRREAT resume context — ${root}`];
  for (const reference of new Set(manifest.active)) {
    if (!/^(?:goals|research|roadmap|execution|analysis|time)\.md#[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(reference)) throw new Error(`Invalid context reference: ${reference}`);
    const [file, id] = reference.split('#');
    const content = files[file];
    const blocks = [...content.matchAll(/<!--\s*grreat:record\s+([^>]+?)\s*-->([\s\S]*?)(?=<!--\s*grreat:record|$)/g)];
    const selected = blocks.filter((match) => match[1].split(/\s+/).includes(`id=${id}`));
    if (selected.length !== 1) throw new Error(`Missing or ambiguous context record: ${reference}`);
    output.push(`\n## ${reference}\n${selected[0][0].trim()}`);
  }
  const records = CANONICAL_FILES.flatMap((file) => parseRecords(files[file]).map((record) => ({ ...record, file })));
  const focusErrors = validateFocus(manifest, records);
  if (focusErrors.length) throw new Error(focusErrors.map((error) => `${error.code}: ${error.message}`).join('\n'));
  output.splice(1, 0, ...await gitSnapshot(root));
  return output.join('\n');
}

export async function findBacklinks(directory, page) {
  const root = resolve(directory);
  const explicitPath = page.includes('/');
  const target = posix.normalize(page.endsWith('.md') ? page : `${page}.md`);
  const notes = await listVaultNotes(root);
  const targets = notes.filter((file) => file === target || (!explicitPath && basename(file) === target));
  if (targets.length !== 1) throw new Error('Backlink target is missing or ambiguous; use its path within the vault.');
  const inbound = [];
  for (const file of notes) {
    for (const link of markdownLinks(await readFile(join(root, file), 'utf8'))) {
      const resolved = resolveNoteLink(link, file, notes);
      if (resolved.matches?.length === 1 && resolved.matches[0] === targets[0]) {
        inbound.push({ file, line: link.line, target: link.file, ...(link.anchor ? { anchor: link.anchor } : {}) });
      }
    }
  }
  return inbound;
}

async function main(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--directory', '--title', '--page'].includes(flag) || !args[index + 1]) throw new Error(`Invalid option: ${flag}`);
    options[flag.slice(2)] = args[index + 1];
  }
  const directory = options.directory ?? 'docs/grreat';
  if (command === 'init') console.log(JSON.stringify(await initializeProject({ directory, title: options.title })));
  else if (command === 'context') console.log(await resumeContext(directory));
  else if (command === 'backlinks' && options.page) console.log(JSON.stringify(await findBacklinks(directory, options.page), null, 2));
  else if (!command || command === '--help') console.log('Usage: node project.mjs init --title "Project" [--directory docs/grreat]\n       node project.mjs context [--directory docs/grreat]\n       node project.mjs backlinks --page goals [--directory docs/grreat]');
  else throw new Error('Expected init, context, or backlinks --page NAME.');
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
