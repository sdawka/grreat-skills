/**
 * Deterministic parser and validator for the canonical GRREAT Markdown protocol.
 * Records are deliberately declared in HTML comments so Markdown remains pleasant
 * to read while IDs, parentage, and active context remain machine-checkable.
 */

import { markdownLinks, resolveNoteLink } from './links.mjs';

export const PROTOCOL_VERSION = 1;
export const CANONICAL_FILES = [
  'README.md',
  'goals.md',
  'research.md',
  'roadmap.md',
  'execution.md',
  'analysis.md',
  'time.md',
];

const RECORD_RE = /<!--\s*grreat:record\s+([^>]+?)\s*-->/g;
const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([a-z][a-z0-9_-]*)=([^\s]+)/gi)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

export function parseRecords(markdown) {
  const records = [];
  for (const match of markdown.matchAll(RECORD_RE)) {
    const attributes = parseAttributes(match[1]);
    records.push({
      ...attributes,
      id: attributes.id,
      parent: attributes.parent && attributes.parent !== 'none' ? attributes.parent : null,
      level: attributes.level ? Number(attributes.level) : undefined,
      line: markdown.slice(0, match.index ?? 0).split('\n').length,
    });
  }
  return records;
}

export function parseManifest(markdown) {
  const match = markdown.match(/<!--\s*grreat:manifest\s+([^>]+?)\s*-->/);
  if (!match) throw new Error('Missing grreat manifest');
  const attributes = parseAttributes(match[1]);
  return {
    version: Number(attributes.version),
    root: attributes.root,
    active: attributes.active ? attributes.active.split(',').filter(Boolean) : [],
  };
}

function issue(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
}

function fileAndAnchor(reference) {
  const hash = reference.indexOf('#');
  return hash === -1 ? { file: reference, anchor: undefined } : {
    file: reference.slice(0, hash),
    anchor: reference.slice(hash + 1),
  };
}

function decisionIds(markdown) {
  return new Set([...markdown.matchAll(/\bDEC-[A-Z0-9-]+\b/g)].map((match) => match[0]));
}

function isGoalTreeRecord(record) {
  return record.role === 'north_star' || record.role === 'goal' || record.role === 'obverse'
    || ['north_star', 'goal', 'objective', 'obverse'].includes(record.kind);
}

/** The resume manifest must select the same current focus as the record statuses. */
export function validateFocus(manifest, records) {
  const errors = [];
  for (const kind of ['roadmap_item', 'execution_item']) {
    const active = records.filter((record) => record.kind === kind && record.status === 'active');
    if (active.length !== 1) {
      errors.push(issue('ACTIVE_RECORD', `Expected exactly one active ${kind}, found ${active.length}`));
      continue;
    }
    if (!manifest) continue;
    const selected = records.filter((record) => record.kind === kind
      && manifest.active.includes(`${record.file}#${record.id}`));
    if (selected.length !== 1 || selected[0] !== active[0]) {
      const reference = `${active[0].file}#${active[0].id}`;
      errors.push(issue('MANIFEST_FOCUS', `Manifest must select only the active ${kind}: ${reference}`, 'README.md'));
    }
  }
  return errors;
}

export function validateWorkspace(files) {
  const errors = [];
  const records = [];
  const byId = new Map();

  for (const file of CANONICAL_FILES) {
    if (typeof files[file] !== 'string') errors.push(issue('FILE_MISSING', `Missing canonical file ${file}`, file));
  }
  if (typeof files['README.md'] !== 'string') return { valid: false, errors, records, manifest: null };

  let manifest = null;
  try {
    manifest = parseManifest(files['README.md']);
    if (manifest.version !== PROTOCOL_VERSION) errors.push(issue('MANIFEST_VERSION', `Manifest version must be ${PROTOCOL_VERSION}`, 'README.md'));
  } catch (error) {
    errors.push(issue('MANIFEST_MISSING', error instanceof Error ? error.message : 'Missing grreat manifest', 'README.md'));
  }

  for (const file of CANONICAL_FILES) {
    if (typeof files[file] !== 'string') continue;
    for (const record of parseRecords(files[file])) {
      if (!record.id || !ID_RE.test(record.id)) errors.push(issue('INVALID_ID', `Invalid record ID ${record.id ?? '(missing)'}`, file));
      if (record.id && byId.has(record.id)) errors.push(issue('DUPLICATE_ID', `Duplicate record ID ${record.id}`, file));
      if (record.id) byId.set(record.id, { ...record, file });
      records.push({ ...record, file });
    }
  }

  const rootRecords = records.filter((record) => record.role === 'north_star' || record.kind === 'north_star');
  if (rootRecords.length !== 1) errors.push(issue('NORTH_STAR_COUNT', `Expected one north star, found ${rootRecords.length}`));
  const root = rootRecords[0];
  if (root?.parent) errors.push(issue('NORTH_STAR_PARENT', 'North star cannot have a parent', root.file));
  if (root && !root.obverse) errors.push(issue('OBVERSE_REFERENCE', 'North star must declare an Obverse record', root.file));
  if (root?.obverse) {
    const obverse = byId.get(root.obverse);
    if (!obverse) errors.push(issue('OBVERSE_REFERENCE', `Obverse ${root.obverse} is missing`, root.file));
    else if (obverse.kind !== 'obverse' || obverse.role !== 'obverse') {
      errors.push(issue('OBVERSE_ROLE', `Obverse ${root.obverse} must declare kind=obverse and role=obverse`, root.file));
    }
  }

  for (const record of records) {
    const isGoalRecord = isGoalTreeRecord(record);
    if (record.kind === 'obverse' && record.role !== 'obverse') errors.push(issue('OBVERSE_ROLE', `${record.id} must declare role=obverse`, record.file));
    if (record.role === 'obverse' && record.kind !== 'obverse') errors.push(issue('OBVERSE_ROLE', `${record.id} must declare kind=obverse`, record.file));
    if (record.parent && !byId.has(record.parent)) errors.push(issue('PARENT_REFERENCE', `Parent ${record.parent} is missing`, record.file));
    if ((record.role === 'goal' || record.kind === 'goal') && record.id !== root?.id && !record.parent) {
      errors.push(issue('GOAL_PARENT', `${record.id} must belong to the goal tree`, record.file));
    }
    if (isGoalRecord && record.parent && byId.has(record.parent) && !isGoalTreeRecord(byId.get(record.parent))) {
      errors.push(issue('GOAL_PARENT_TYPE', `${record.id} must have a goal-tree parent`, record.file));
    }
    if (record.decision && !decisionIds(files['decision_log.md'] ?? '').has(record.decision)) {
      errors.push(issue('DECISION_REFERENCE', `${record.id} references unknown decision ${record.decision}`, record.file));
    }
  }

  for (const record of records.filter(isGoalTreeRecord)) {
    const seen = new Set([record.id]);
    let parent = record.parent;
    let depth = 1;
    while (parent) {
      if (seen.has(parent)) {
        errors.push(issue('GOAL_CYCLE', `Goal tree cycle includes ${parent}`, record.file));
        break;
      }
      seen.add(parent);
      const parentRecord = byId.get(parent);
      depth += 1;
      parent = parentRecord?.parent ?? null;
    }
    if (depth > 3 || (record.level !== undefined && record.level !== depth)) {
      errors.push(issue('GOAL_DEPTH', `${record.id} has ancestry depth ${depth}; maximum is three`, record.file));
    }
  }

  errors.push(...validateFocus(manifest, records));

  for (const file of CANONICAL_FILES) {
    if (typeof files[file] !== 'string') continue;
    for (const link of markdownLinks(files[file])) {
      const resolved = resolveNoteLink(link, file, Object.keys(files));
      if (resolved.external) continue;
      const targetFile = resolved.matches[0] ?? resolved.target;
      const targetAnchor = link.anchor ?? fileAndAnchor(link.file).anchor;
      if (resolved.matches.length > 1) errors.push(issue('LINK_TARGET_AMBIGUOUS', `Note ${resolved.target} is ambiguous; use its path within the vault`, file));
      else if (!resolved.matches.length) errors.push(issue('LINK_TARGET_MISSING', `Note ${targetFile} is missing`, file));
      else if (CANONICAL_FILES.includes(targetFile) && targetAnchor && !records.some((record) => record.file === targetFile && record.id === targetAnchor)) {
        errors.push(issue('LINK_ANCHOR_MISSING', `Link anchor ${targetAnchor} is missing in ${targetFile}`, file));
      }
    }
  }

  if (manifest) {
    for (const reference of manifest.active) {
      const { file, anchor } = fileAndAnchor(reference);
      if (!CANONICAL_FILES.includes(file) || !records.some((record) => record.file === file && record.id === anchor)) {
        errors.push(issue('MANIFEST_CONTEXT', `Manifest context ${reference} is not a record`, 'README.md'));
      }
    }
    if (root && manifest.root !== root.id) errors.push(issue('MANIFEST_ROOT', `Manifest root must be ${root.id}`, 'README.md'));
  }

  return { valid: errors.length === 0, errors, records, manifest };
}
