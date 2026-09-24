import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';

import { CANONICAL_FILES, parseManifest } from './validator.mjs';
import { listVaultNotes } from './links.mjs';

/** Versioned direct-RPC sync contract for the canonical Markdown mirror. */
export const SYNC_PROTOCOL_VERSION = 1;
export const DEFAULT_STATE_PATH = 'docs/grreat/.sync.json';
export const DEFAULT_RPC_ENDPOINT = 'https://grreat.ca/api/agent/v1/rpc';

const RECORD_RE = /<!--\s*grreat:record\s+([^>]+?)\s*-->/g;
const SECTIONS = ['goal', 'research', 'roadmap', 'execution', 'analysis', 'time'];
const SECTION_BY_FILE = {
  'goals.md': 'goal',
  'research.md': 'research',
  'roadmap.md': 'roadmap',
  'execution.md': 'execution',
  'analysis.md': 'analysis',
  'time.md': 'time',
};
const DOCUMENT_HEADINGS = new Set(SECTIONS.map((section) => section === 'goal' ? 'goals' : section));
const SYNC_OWNED_OPTIONAL_FIELDS = {
  goal: ['body', 'kind', 'obverse', 'status'],
  research: ['body', 'kind'],
  roadmap: ['body', 'kind', 'status'],
  execution: ['body', 'kind', 'status'],
  analysis: ['body', 'kind'],
  // Time.kind is immutable after creation in the core lifecycle contract.
  time: ['body', 'status'],
};
const SYNC_CLEAR_VALUES = {
  body: '',
  kind: {
    goal: 'project',
    research: 'question',
    roadmap: 'item',
    execution: 'task',
    analysis: 'observation',
  },
  status: {
    goal: 'active',
    roadmap: 'planned',
    execution: 'todo',
    time: 'scheduled',
  },
  obverse: '',
};
const CONFLICT_CODES = new Set([
  'VERSION_CONFLICT',
  'REQUEST_REUSE',
  'INVALID_RELATION_ENDPOINT',
  'SECTION_MISMATCH',
  'ARCHIVED_ENDPOINT',
  'ALREADY_ARCHIVED',
  'NOTHING_TO_UNDO',
  'NOTHING_TO_REDO',
  'HISTORY_CONFLICT',
  'LEGACY_REPLAY_UNAVAILABLE',
  'GOAL_MEMBERSHIP_REQUIRED',
  'GOAL_HIERARCHY_CONFLICT',
  'GOAL_TREE_ROOT_AMBIGUOUS',
  'TIME_CONFLICT',
]);

/**
 * @typedef {{
 * sourceId: string,
 * file?: string,
 * line?: number,
 * section: 'goal'|'research'|'roadmap'|'execution'|'analysis'|'time',
 * payload: Record<string, unknown>,
 * metadata?: Record<string, unknown>,
 * parent?: string|null,
 * relationKind?: string,
 * digest?: string,
 * }} CanonicalRecord
 */

/** @typedef {{ rpc: (request: object, credentials: { token: string }) => Promise<object>, identify?: (credentials: {token: string}) => Promise<{endpoint: string, workspaceId: string|null}>, prepare?: (credentials: {token: string}) => Promise<void> }} RpcTransport */

const noopDelay = async () => undefined;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function digestRecord(record) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(record))).digest('hex')}`;
}

const DEFAULT_FILESYSTEM = { copyFile, mkdir, open, readFile, rename, unlink };

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidState(value) {
  return isPlainObject(value) && value.schema === 1 && isPlainObject(value.records) &&
    (value.destination === undefined || validDestination(value.destination)) &&
    (value.relations === undefined || isPlainObject(value.relations));
}

function validDestination(value) {
  return isPlainObject(value) && typeof value.endpoint === 'string' && typeof value.workspaceId === 'string'
    && value.workspaceId.length > 0 && value.workspaceId.length <= 256 && !/[\u0000-\u001f]/u.test(value.workspaceId);
}

export function normalizeSyncEndpoint(endpoint = DEFAULT_RPC_ENDPOINT) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Sync endpoint must use HTTPS (or local HTTP), without credentials, query, or fragment.');
  }
  return url.href;
}

function stateError(filePath) {
  const error = new Error(`Invalid GRREAT sync checkpoint: ${filePath}`);
  error.code = 'INVALID_SYNC_STATE';
  return error;
}

async function readCheckpoint(filePath, filesystem) {
  let source;
  try {
    source = await filesystem.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw stateError(filePath);
  }
  if (!isValidState(parsed)) throw stateError(filePath);
  return parsed;
}

async function syncDirectory(directory, filesystem) {
  try {
    const handle = await filesystem.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Directory fsync is not available on every supported filesystem/runtime.
  }
}

/** Create the default ignored JSON state store, or inject a compatible store in tests. */
export function createFileStateStore(filePath = DEFAULT_STATE_PATH, { filesystem: overrides = {} } = {}) {
  const filesystem = { ...DEFAULT_FILESYSTEM, ...overrides };
  const backupPath = `${filePath}.bak`;
  return {
    async read() {
      let primaryError;
      try {
        const primary = await readCheckpoint(filePath, filesystem);
        if (primary !== null) return primary;
      } catch (error) {
        primaryError = error;
      }
      try {
        const backup = await readCheckpoint(backupPath, filesystem);
        if (backup !== null) return backup;
      } catch (backupError) {
        if (!primaryError) throw backupError;
      }
      if (primaryError) throw primaryError;
      return null;
    },
    async write(state) {
      if (!isValidState(state)) throw new TypeError('A valid version-1 sync checkpoint is required');
      const directory = dirname(filePath);
      await filesystem.mkdir(directory, { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      let temporaryReady = false;
      try {
        const handle = await filesystem.open(temporaryPath, 'w');
        temporaryReady = true;
        try {
          await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          const current = await readCheckpoint(filePath, filesystem);
          if (current !== null) await filesystem.copyFile(filePath, backupPath);
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.code !== 'INVALID_SYNC_STATE') throw error;
        }
        await filesystem.rename(temporaryPath, filePath);
        temporaryReady = false;
        await syncDirectory(directory, filesystem);
      } finally {
        if (temporaryReady) {
          try { await filesystem.unlink(temporaryPath); } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
      }
    },
  };
}

/**
 * Parse canonical Markdown record comments and nearby prose into app-shaped records.
 * Obverse is a guardrail on its owning Goal, not a second app record.
 * @param {Record<string, string>} files
 * @param {{ sourceRoot?: string }} [options]
 * @returns {CanonicalRecord[]}
 */
export function parseCanonicalRecords(files, { sourceRoot = 'docs/grreat' } = {}) {
  const raw = [];
  for (const file of CANONICAL_FILES) {
    if (file === 'README.md' || typeof files?.[file] !== 'string') continue;
    const section = SECTION_BY_FILE[file];
    if (!section) continue;
    const markdown = files[file];
    const matches = [...markdown.matchAll(RECORD_RE)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const attributes = parseAttributes(match[1]);
      const text = markdown.slice((match.index ?? 0) + match[0].length, next?.index ?? markdown.length);
      const extracted = extractTitleBody(text, section);
      raw.push({
        ...attributes,
        id: attributes.id,
        file,
        section,
        line: markdown.slice(0, match.index ?? 0).split('\n').length,
        ...extracted,
        parent: attributes.parent && attributes.parent !== 'none' ? attributes.parent : null,
      });
    }
  }

  const byId = new Map(raw.filter((record) => record.id).map((record) => [record.id, record]));
  const obverseByOwner = new Map();
  for (const record of raw) {
    if (record.kind !== 'obverse' && record.role !== 'obverse') continue;
    const owner = raw.find((candidate) => candidate.obverse === record.id)
      ?? (record.parent ? byId.get(record.parent) : undefined);
    if (owner?.id) obverseByOwner.set(owner.id, record.body || record.title || '');
  }

  return raw
    .filter((record) => record.id && record.kind !== 'obverse' && record.role !== 'obverse')
    .map((record) => normalizeCanonicalRecord(record, {
      sourceRoot,
      obverse: obverseByOwner.get(record.id),
      parentSection: byId.get(record.parent)?.section,
    }));
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([a-z][a-z0-9_-]*)=([^\s]+)/gi)) attributes[match[1]] = match[2];
  return attributes;
}

function extractTitleBody(text, section) {
  const lines = text.replace(/^\s+|\s+$/gu, '').split('\n');
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (match) headings.push({ index, title: match[1].trim() });
  }
  let heading = headings[0];
  if (heading && DOCUMENT_HEADINGS.has(heading.title.toLowerCase()) && headings[1]) heading = headings[1];
  if (!heading) return { title: `${section} record`, body: lines.join('\n').trim() };
  return { title: heading.title, body: lines.slice(heading.index + 1).join('\n').trim() };
}

function normalizeCanonicalRecord(record, { sourceRoot, obverse, parentSection }) {
  const section = record.section;
  const payload = payloadForRecord(record, section, obverse);
  const source = {
    type: 'canonical_markdown',
    path: `${sourceRoot}/${record.file}`,
    recordId: record.id,
    line: record.line,
    ...(record.kind ? { kind: record.kind } : {}),
    ...(record.role ? { role: record.role } : {}),
  };
  const normalized = {
    sourceId: record.id,
    id: record.id,
    file: record.file,
    line: record.line,
    section,
    payload,
    metadata: { source },
    parent: record.parent ?? null,
    relationKind: relationKindFor(record, parentSection),
  };
  return { ...normalized, digest: digestRecord(syncShape(normalized)) };
}

function relationKindFor(record, parentSection) {
  if (!record.parent) return undefined;
  if (record.section === 'goal') return 'subgoal-of';
  return parentSection === 'goal' ? 'belongs-to' : 'related-to';
}

function payloadForRecord(record, section, obverse) {
  const payload = { title: record.title || record.id };
  if (record.body) payload.body = record.body;
  if (section === 'goal') {
    payload.role = record.kind === 'north_star' || record.role === 'north_star' ? 'north_star' : 'goal';
    if (['project', 'program'].includes(record.kind)) payload.kind = record.kind;
    if (['draft', 'active', 'achieved', 'paused'].includes(record.status)) payload.status = record.status;
    if (obverse) payload.obverse = obverse;
    return payload;
  }
  const validKinds = {
    research: ['question', 'finding', 'source'],
    roadmap: ['item', 'epic', 'milestone'],
    execution: ['action', 'task', 'log', 'session'],
    analysis: ['review', 'decision', 'observation'],
    time: ['estimate', 'entry', 'planned', 'actual', 'completion'],
  };
  if (validKinds[section]?.includes(record.kind)) payload.kind = record.kind;
  else if (section === 'roadmap' && record.kind === 'roadmap_item') payload.kind = 'item';
  else if (section === 'execution' && record.kind === 'execution_item') payload.kind = 'task';
  if (section === 'roadmap' && ['planned', 'active', 'complete', 'paused'].includes(record.status)) payload.status = record.status;
  if (section === 'execution' && ['todo', 'doing', 'done', 'blocked'].includes(record.status)) payload.status = record.status;
  if (section === 'time' && ['scheduled', 'cancelled'].includes(record.status)) payload.status = record.status;
  return payload;
}

function syncShape(record) {
  return {
    sourceId: record.sourceId,
    section: record.section,
    payload: record.payload,
    metadata: record.metadata ?? {},
    parent: record.parent ?? null,
    relationKind: record.relationKind,
  };
}

function normalizeInputRecord(record) {
  const sourceId = record?.sourceId ?? record?.id;
  if (typeof sourceId !== 'string' || sourceId.length === 0) throw new TypeError('Canonical records require sourceId');
  const section = SECTIONS.includes(record.section) ? record.section : 'research';
  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload
    : { title: record.title ?? sourceId };
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : { source: { type: 'canonical_markdown', recordId: sourceId } };
  const normalized = {
    ...record,
    sourceId,
    id: sourceId,
    section,
    payload,
    metadata,
    parent: record.parent ?? null,
    relationKind: record.relationKind ?? (record.parent ? (section === 'goal' ? 'subgoal-of' : 'related-to') : undefined),
  };
  return { ...normalized, digest: record.digest ?? digestRecord(syncShape(normalized)) };
}

function stateRecordsFor(records, previous, { markPending = false } = {}) {
  const next = { ...(previous?.records ?? {}) };
  for (const record of records) {
    const current = next[record.sourceId] ?? {};
    const entry = {
      ...current,
      sourceId: record.sourceId,
      source: record.metadata?.source,
    };
    if (entry.digest !== record.digest) {
      entry.pendingDigest = record.digest;
      if (markPending) entry.pending = true;
    } else {
      delete entry.pendingDigest;
    }
    next[record.sourceId] = entry;
  }
  return next;
}

function stateFor(records, sourceRoot, status, now, previous, extras = {}) {
  return {
    schema: 1,
    sourceRoot,
    updatedAt: now(),
    status,
    ...(extras.destination || previous?.destination ? { destination: extras.destination ?? previous.destination } : {}),
    records: extras.records ?? stateRecordsFor(records, previous, extras),
    ...(extras.relations || previous?.relations ? { relations: extras.relations ?? previous.relations } : {}),
    conflicts: extras.conflicts ?? [],
    ...(extras.pendingReason ? { pendingReason: extras.pendingReason } : {}),
    ...(extras.receipts?.length ? { receipts: extras.receipts } : {}),
  };
}

async function writeState(stateStore, state) {
  if (!stateStore || typeof stateStore.write !== 'function') throw new TypeError('A sync state store with write(state) is required');
  await stateStore.write(state);
}

function requestIdFor(kind, commands) {
  return `grreat-sync-${kind}-${createHash('sha256').update(JSON.stringify(stableValue(commands))).digest('hex').slice(0, 48)}`;
}

function applyBatchRequest(commands, kind) {
  return {
    version: SYNC_PROTOCOL_VERSION,
    operation: 'command',
    requestId: requestIdFor(kind, commands),
    command: { type: 'apply_batch', commands },
  };
}

function createCommand(record, parentRemoteId) {
  const command = {
    type: 'create_record',
    section: record.section,
    payload: record.payload,
    metadata: record.metadata,
  };
  if (parentRemoteId && record.parent) {
    command.relations = [{
      toRecordId: parentRemoteId,
      kind: record.relationKind ?? (record.section === 'goal' ? 'subgoal-of' : 'belongs-to'),
      metadata: {
        source: {
          type: 'canonical_markdown',
          recordId: record.sourceId,
          parentId: record.parent,
        },
      },
    }];
  }
  return command;
}

function clearValueFor(section, field) {
  const value = SYNC_CLEAR_VALUES[field];
  if (value && typeof value === 'object') return value[section];
  return value;
}

function payloadPatchForRecord(record, remote) {
  const patch = { ...record.payload };
  const previousPayload = remote?.syncedPayload;
  for (const field of SYNC_OWNED_OPTIONAL_FIELDS[record.section] ?? []) {
    if (!(field in record.payload) &&
        (!previousPayload || typeof previousPayload !== 'object' || field in previousPayload)) {
      const clearValue = clearValueFor(record.section, field);
      if (clearValue !== undefined) patch[field] = clearValue;
    }
  }
  return patch;
}

function remoteMatchesCanonical(record, remote, prior) {
  if (!remote?.payload || typeof remote.payload !== 'object') return true;
  const expected = payloadPatchForRecord(record, prior);
  return Object.entries(expected).every(([field, value]) =>
    JSON.stringify(remote.payload[field]) === JSON.stringify(value));
}

function updateCommand(record, remote) {
  return {
    type: 'update_record',
    section: record.section,
    recordId: remote.remoteId,
    expectedVersion: Number.isInteger(remote.version) && remote.version > 0 ? remote.version : 1,
    payloadPatch: payloadPatchForRecord(record, remote),
    metadataPatch: record.metadata,
  };
}

function relationCommand(record, parentRemoteId, remoteId) {
  return {
    type: 'create_relation',
    fromRecordId: remoteId,
    toRecordId: parentRemoteId,
    kind: record.relationKind ?? (record.section === 'goal' ? 'subgoal-of' : 'belongs-to'),
    metadata: {
      source: {
        type: 'canonical_markdown',
        recordId: record.sourceId,
        parentId: record.parent,
      },
    },
  };
}

function archiveRelationCommand(relation) {
  return {
    type: 'archive_relation',
    relationId: relation.remoteId,
    expectedVersion: Number.isInteger(relation.version) && relation.version > 0 ? relation.version : 1,
  };
}

function contentDigest(record) {
  return digestRecord({ section: record.section, payload: record.payload, metadata: record.metadata ?? {} });
}

function relationDigest(record) {
  return digestRecord({ sourceId: record.sourceId, parent: record.parent ?? null, kind: record.relationKind });
}

function relationStateFor(previous, sourceId) {
  const direct = previous?.relations?.[sourceId];
  if (direct) return direct;
  const legacy = Object.entries(previous?.relations ?? {})
    .find(([key]) => key.startsWith(`${sourceId}::`));
  return legacy
    ? { ...legacy[1], parentSourceId: legacy[1].parentSourceId ?? legacy[0].slice(sourceId.length + 2) }
    : null;
}

function parentChanged(record, prior, relation) {
  const priorParent = relation?.parentSourceId ?? prior?.parentSourceId;
  return priorParent !== undefined && priorParent !== (record.parent ?? null);
}

function contentChanged(record, prior) {
  if (!prior?.remoteId) return false;
  const current = contentDigest(record);
  if (prior.contentDigest) return prior.contentDigest !== current;
  // Legacy state cannot prove that a digest delta was parent-only. Treat it as
  // content-dirty as well, so a simultaneous edit is never silently dropped.
  return prior.digest !== record.digest;
}

function markPendingRecord(nextRecords, record, { conflict = false } = {}) {
  const entry = nextRecords[record.sourceId] ?? { sourceId: record.sourceId };
  const next = {
    ...entry,
    sourceId: record.sourceId,
    source: record.metadata?.source,
    pending: true,
    pendingDigest: record.digest,
    ...(conflict ? { conflict: true } : {}),
  };
  nextRecords[record.sourceId] = next;
}

function installRecordResult(nextRecords, record, remote, receipt) {
  if (!remote?.id) return false;
  const prior = nextRecords[record.sourceId] ?? {};
  nextRecords[record.sourceId] = {
    ...prior,
    sourceId: record.sourceId,
    source: record.metadata?.source,
    remoteId: remote.id,
    version: Number.isInteger(remote.version) ? remote.version : (prior.version ?? 1),
    digest: record.digest,
    contentDigest: contentDigest(record),
    syncedPayload: remote.payload && typeof remote.payload === 'object' ? structuredClone(remote.payload) : structuredClone(record.payload),
    syncedMetadata: remote.metadata && typeof remote.metadata === 'object' ? structuredClone(remote.metadata) : structuredClone(record.metadata ?? {}),
    ...(record.parent !== undefined ? { parentSourceId: record.parent ?? null } : {}),
    conflict: false,
    pending: false,
    ...(receipt === undefined ? {} : { receipt }),
  };
  delete nextRecords[record.sourceId].pendingDigest;
  return true;
}

function responseData(response) {
  if (response?.ok === true) return response.data && typeof response.data === 'object' ? response.data : {};
  // Keep old injected transports readable while the real transport always returns RpcWireResult.
  if (response && typeof response === 'object' && response.status) return response;
  return null;
}

function responseError(response) {
  if (response?.ok === false) {
    const error = response.error ?? { code: 'INTERNAL_ERROR', message: 'RPC failed' };
    return {
      ...error,
      ...(response.httpStatus !== undefined ? { httpStatus: response.httpStatus } : {}),
    };
  }
  return null;
}

function isConflictError(error) {
  return Boolean(error && (
    CONFLICT_CODES.has(error.code) || error.httpStatus === 409 || error.status === 409
  ));
}

function idForResponseRecord(command, responseRecords, used) {
  if (command.type === 'update_record') {
    return responseRecords.find((record) => record.id === command.recordId && !used.has(record)) ?? null;
  }
  const sourceId = command.metadata?.source?.recordId;
  return responseRecords.find((record) => record.metadata?.source?.recordId === sourceId && !used.has(record))
    ?? responseRecords.find((record) => record.section === command.section && record.payload?.title === command.payload.title && !used.has(record))
    ?? responseRecords.find((record) => !used.has(record))
    ?? null;
}

/**
 * @param {{ records: Array<Record<string, any>>, credentials?: {token: string}, transport: RpcTransport, batchSize?: number, retries?: number, delay?: (attempt: number) => Promise<void>, stateStore?: { read?: () => Promise<unknown>, write: (state: object) => Promise<void> }, sourceRoot?: string, now?: () => string, destination?: {endpoint: string, workspaceId: string|null}, dryRun?: boolean, bindExisting?: string }} options
 * @returns {Promise<{status: string, applied: number, conflicts: string[], reason?: string, destination?: object, expectedDestination?: object, changes?: object[], counts?: object, requiresBinding?: boolean, requiresAllocation?: boolean}>}
 *
 * Send canonical records to the direct agent RPC in bounded, retryable apply_batch commands.
 * Markdown is authoritative: this helper only creates/updates records and relationships; it
 * never deletes, archives, or downloads remote state. Conflicts remain visible in .sync.json.
 */
export async function syncCanonicalRecords({
  records,
  credentials,
  transport,
  batchSize = 25,
  retries = 2,
  delay = noopDelay,
  stateStore = createFileStateStore(),
  sourceRoot = 'docs/grreat',
  now = () => new Date().toISOString(),
  destination,
  dryRun = false,
  bindExisting,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new RangeError('batchSize must be between 1 and 25');
  const canonicalRecords = (Array.isArray(records) ? records : []).map(normalizeInputRecord);
  const previous = typeof stateStore?.read === 'function' ? await stateStore.read() : null;
  if (!credentials?.token) {
    if (!dryRun) await writeState(stateStore, stateFor(canonicalRecords, sourceRoot, 'pending', now, previous, {
      records: stateRecordsFor(canonicalRecords, previous, { markPending: true }),
      pendingReason: 'missing_credentials',
    }));
    return { status: 'pending', reason: 'missing_credentials', applied: 0, conflicts: [] };
  }
  if (!transport || typeof transport.rpc !== 'function') throw new TypeError('A direct-RPC transport is required');
  // Real HTTP transports authenticate their destination even when there are no changes.
  // Injected transports may provide an already authenticated destination explicitly.
  if (typeof transport.identify === 'function') {
    try {
      const authenticated = await transport.identify(credentials);
      if (destination && (destination.endpoint !== authenticated.endpoint || destination.workspaceId !== authenticated.workspaceId)) {
        return { status: 'pending', reason: 'destination_mismatch', destination: authenticated, expectedDestination: destination, applied: 0, conflicts: [] };
      }
      destination = authenticated;
    }
    catch { return { status: 'pending', reason: 'destination_unverified', applied: 0, conflicts: [] }; }
  }
  if (!destination) return { status: 'pending', reason: 'destination_unverified', applied: 0, conflicts: [] };
  const hasRemoteState = Object.values(previous?.records ?? {}).some((entry) => entry.remoteId)
    || Object.keys(previous?.relations ?? {}).length > 0;
  if (destination?.workspaceId === null) {
    if (previous?.destination || hasRemoteState) return { status: 'pending', reason: 'destination_unallocated', destination, applied: 0, conflicts: [] };
    if (dryRun) return { status: 'preview', destination, requiresAllocation: true, ...previewSyncChanges(canonicalRecords, previous), applied: 0, conflicts: [] };
    try {
      await transport.prepare(credentials);
      destination = await transport.identify(credentials);
      if (!destination.workspaceId) throw new Error('Workspace is still unallocated');
    } catch { return { status: 'pending', reason: 'destination_unverified', applied: 0, conflicts: [] }; }
  }
  if (destination && !validDestination(destination)) throw new Error('Invalid authenticated sync destination.');
  if (previous?.destination && (!destination || previous.destination.endpoint !== destination.endpoint || previous.destination.workspaceId !== destination.workspaceId)) {
    return { status: 'pending', reason: 'destination_mismatch', destination, expectedDestination: previous.destination, applied: 0, conflicts: [] };
  }
  const legacyBindingRequired = destination && !previous?.destination && hasRemoteState;
  const proposal = previewSyncChanges(canonicalRecords, previous);
  if (dryRun) return {
    status: 'preview', destination, ...proposal,
    ...(legacyBindingRequired ? { requiresBinding: true } : {}), applied: 0, conflicts: [],
  };
  if (legacyBindingRequired && bindExisting !== destination.workspaceId) {
    return { status: 'pending', reason: 'legacy_destination_unbound', destination, ...proposal, applied: 0, conflicts: [] };
  }

  const priorRecords = previous?.records ?? {};
  const nextRecords = stateRecordsFor(canonicalRecords, previous);
  // Keep mappings for records omitted from the current Markdown snapshot. A
  // temporary omission is not an archive/delete instruction, and re-adding a
  // record must be able to reuse its existing remote relation.
  const nextRelations = { ...(previous?.relations ?? {}) };
  for (const record of canonicalRecords) {
    const priorRelation = relationStateFor(previous, record.sourceId);
    if (priorRelation) nextRelations[record.sourceId] = { ...priorRelation };
  }
  const changed = canonicalRecords.filter((record) => {
    const entry = priorRecords[record.sourceId];
    return !entry || entry.digest !== record.digest || !entry.remoteId || entry.conflict === true || entry.pending === true;
  });
  const relationWork = canonicalRecords.some((record) => {
    const entry = priorRecords[record.sourceId];
    const relation = nextRelations[record.sourceId];
    if (!entry?.remoteId || (record.parent && !priorRecords[record.parent]?.remoteId)) return false;
    if (!record.parent && !relation?.parentSourceId) return false;
    return !relation || relation.parentSourceId !== (record.parent ?? null)
      || relation.digest !== relationDigest(record) || relation.pending === true;
  });
  if (canonicalRecords.length === 0 || (changed.length === 0 && !relationWork)) {
    await writeState(stateStore, stateFor(canonicalRecords, sourceRoot, 'clean', now, previous, {
      destination,
      records: nextRecords,
      relations: nextRelations,
    }));
    return { status: 'no-op', applied: 0, conflicts: [] };
  }

  // Bind before any remote record/relation write. A crash after dispatch must
  // never leave these same local records free to sync into another account.
  await writeState(stateStore, stateFor(canonicalRecords, sourceRoot, 'pending', now, previous, {
    destination,
    records: stateRecordsFor(canonicalRecords, previous, { markPending: true }),
    relations: nextRelations,
    pendingReason: 'sync_in_progress',
  }));

  const conflicts = [];
  const stateConflicts = [];
  const receipts = [];
  let applied = 0;
  let pendingReason;
  let sawConflict = false;

  async function persist(status = pendingReason ? 'pending' : sawConflict ? 'conflict' : 'clean') {
    await writeState(stateStore, stateFor(canonicalRecords, sourceRoot, status, now, previous, {
      destination,
      records: nextRecords,
      relations: nextRelations,
      conflicts: stateConflicts,
      pendingReason,
      receipts,
    }));
  }

  function markGroupPending(group, { conflict = false } = {}) {
    for (const record of group.records ?? []) markPendingRecord(nextRecords, record, { conflict });
    for (const sourceId of group.relationSourceIds ?? []) {
      const relation = nextRelations[sourceId] ?? {};
      nextRelations[sourceId] = { ...relation, pending: true };
    }
  }

  async function dispatchGroups(groups, kind, onSuccess) {
    for (let offset = 0; offset < groups.length;) {
      const selected = [];
      let commandCount = 0;
      while (offset + selected.length < groups.length && selected.length < batchSize) {
        const group = groups[offset + selected.length];
        if (selected.length > 0 && commandCount + group.commands.length > 25) break;
        selected.push(group);
        commandCount += group.commands.length;
      }
      const batch = selected.flatMap((group) => group.commands);
      const request = applyBatchRequest(batch, kind);
      let response;
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          response = await transport.rpc(request, credentials);
          break;
        } catch (error) {
          lastError = error;
          if (attempt === retries) break;
          await delay(attempt + 1);
        }
      }
      if (!response) {
        pendingReason = `transport_error:${lastError?.message?.slice(0, 160) ?? 'rpc'}`;
        for (const group of groups.slice(offset)) markGroupPending(group);
        await persist();
        return false;
      }
      const error = responseError(response);
      if (error) {
        if (isConflictError(error)) {
          sawConflict = true;
          for (const group of selected) {
            markGroupPending(group, { conflict: true });
            for (const id of [...(group.sourceIds ?? []), ...(group.relationSourceIds ?? [])]) {
              if (!conflicts.includes(id)) conflicts.push(id);
              stateConflicts.push({ id, batch: offset / batchSize, code: error.code });
            }
          }
          for (const group of groups.slice(offset + selected.length)) markGroupPending(group);
        } else {
          pendingReason = `rpc_error:${error.code ?? 'unknown'}`;
          for (const group of groups.slice(offset)) markGroupPending(group);
        }
        await persist();
        return false;
      }
      const data = responseData(response);
      let successful = 0;
      const usedRecords = new Set();
      const usedRelations = new Set();
      for (const group of selected) {
        const didInstall = onSuccess(group, data, { usedRecords, usedRelations });
        if (didInstall === false) {
          pendingReason = 'rpc_error:missing_receipt';
          markGroupPending(group);
          for (const later of groups.slice(offset + selected.length)) markGroupPending(later);
          await persist();
          return false;
        }
        successful += group.sourceIds?.length ?? group.relationSourceIds?.length ?? 0;
      }
      if (data.receipt !== undefined) receipts.push(data.receipt);
      applied += (Array.isArray(data?.records) ? data.records.length : 0)
        + (Array.isArray(data?.relations) ? data.relations.length : 0)
        || successful;
      offset += selected.length;
      await persist();
    }
    return true;
  }

  const remainingCreates = canonicalRecords.filter((record) => !priorRecords[record.sourceId]?.remoteId);
  while (remainingCreates.length > 0 && !pendingReason && !sawConflict) {
    const ready = remainingCreates
      .filter((record) => !record.parent || nextRecords[record.parent]?.remoteId)
      .sort((left, right) => Number(left.section !== 'goal') - Number(right.section !== 'goal'));
    if (ready.length === 0) {
      pendingReason = 'missing_parent_dependency';
      for (const record of remainingCreates) markPendingRecord(nextRecords, record);
      await persist();
      break;
    }
    const stage = ready;
    const groups = stage.map((record) => ({
      commands: [createCommand(record, record.parent ? nextRecords[record.parent]?.remoteId : undefined)],
      sourceIds: [record.sourceId],
      records: [record],
    }));
    await dispatchGroups(groups, 'records-create', (group, data, context) => {
      const responseRecords = Array.isArray(data?.records) ? data.records : [];
      const record = group.records[0];
      const remote = idForResponseRecord(group.commands[0], responseRecords, context.usedRecords);
      if (!installRecordResult(nextRecords, record, remote, data.receipt)) return false;
      const relation = (Array.isArray(data?.relations) ? data.relations : [])
        .find((candidate) => candidate.fromRecordId === remote.id && candidate.archivedAt === null);
      if (record.parent && relation) {
        nextRelations[record.sourceId] = {
          remoteId: relation.id,
          version: relation.version ?? 1,
          parentSourceId: record.parent,
          digest: relationDigest(record),
          pending: false,
          ...(data.receipt === undefined ? {} : { receipt: data.receipt }),
        };
      }
      return true;
    });
    for (const record of stage) remainingCreates.splice(remainingCreates.indexOf(record), 1);
  }

  const parentMoves = canonicalRecords.filter((record) => {
    const prior = priorRecords[record.sourceId];
    const relation = nextRelations[record.sourceId];
    return !pendingReason && !sawConflict && prior?.remoteId && nextRecords[record.sourceId]?.remoteId
      && parentChanged(record, prior, relation)
      && (!record.parent || nextRecords[record.parent]?.remoteId)
      && relation?.remoteId;
  });
  const parentMoveGroups = parentMoves.map((record) => {
    const relation = nextRelations[record.sourceId];
    const commands = [archiveRelationCommand(relation)];
    if (record.parent) commands.push(relationCommand(record, nextRecords[record.parent].remoteId, nextRecords[record.sourceId].remoteId));
    return { commands, sourceIds: [], relationSourceIds: [record.sourceId], records: [record], relationMove: true };
  });
  if (!pendingReason && !sawConflict && parentMoveGroups.length > 0) {
    await dispatchGroups(parentMoveGroups, 'relations-parent-change', (group, data, context) => {
      const record = group.records[0];
      const relations = Array.isArray(data?.relations) ? data.relations : [];
      const created = group.commands.find((command) => command.type === 'create_relation');
      const relation = created
        ? relations.find((candidate) => candidate.id !== group.commands[0].relationId && candidate.archivedAt === null && !context.usedRelations.has(candidate))
        : relations.find((candidate) => candidate.id === group.commands[0].relationId);
      if (created && !relation?.id) return false;
      if (created) {
        context.usedRelations.add(relation);
        nextRelations[record.sourceId] = {
          remoteId: relation.id,
          version: relation.version ?? 1,
          parentSourceId: record.parent,
          digest: relationDigest(record),
          pending: false,
          ...(data.receipt === undefined ? {} : { receipt: data.receipt }),
        };
      } else {
        nextRelations[record.sourceId] = {
          ...nextRelations[record.sourceId],
          parentSourceId: null,
          archived: true,
          pending: false,
          ...(relation?.version ? { version: relation.version } : {}),
        };
      }
      const needsContent = contentChanged(record, priorRecords[record.sourceId]);
      if (!needsContent) {
        nextRecords[record.sourceId] = {
          ...nextRecords[record.sourceId],
          digest: record.digest,
          parentSourceId: record.parent ?? null,
          pending: false,
          conflict: false,
        };
        delete nextRecords[record.sourceId].pendingDigest;
      } else {
        nextRecords[record.sourceId] = { ...nextRecords[record.sourceId], parentSourceId: record.parent ?? null };
      }
      return true;
    });
  }

  const updates = changed.filter((record) => priorRecords[record.sourceId]?.remoteId
    && contentChanged(record, priorRecords[record.sourceId]));
  if (!pendingReason && !sawConflict && updates.length > 0) {
    const groups = updates.map((record) => ({
      commands: [updateCommand(record, nextRecords[record.sourceId])],
      sourceIds: [record.sourceId],
      records: [record],
    }));
    await dispatchGroups(groups, 'records-update', (group, data) => {
      const record = group.records[0];
      const responseRecords = Array.isArray(data?.records) ? data.records : [];
      const remote = responseRecords.find((candidate) => candidate.id === nextRecords[record.sourceId]?.remoteId);
      if (!remote) return false;
      if (!remoteMatchesCanonical(record, remote, nextRecords[record.sourceId])) return false;
      return installRecordResult(nextRecords, record, remote, data.receipt);
    });
  }

  const relationGroups = canonicalRecords.filter((record) => {
    const relation = nextRelations[record.sourceId];
    if (!nextRecords[record.sourceId]?.remoteId || !record.parent || !nextRecords[record.parent]?.remoteId) return false;
    if (parentMoves.includes(record)) return false;
    return !relation || relation.parentSourceId !== record.parent || relation.digest !== relationDigest(record) || relation.pending === true;
  }).map((record) => ({
    commands: [relationCommand(record, nextRecords[record.parent].remoteId, nextRecords[record.sourceId].remoteId)],
    sourceIds: [],
    relationSourceIds: [record.sourceId],
    records: [record],
  }));
  if (!pendingReason && !sawConflict && relationGroups.length > 0) {
    await dispatchGroups(relationGroups, 'relations', (group, data, context) => {
      const record = group.records[0];
      const relation = (Array.isArray(data?.relations) ? data.relations : [])
        .find((candidate) => !context.usedRelations.has(candidate));
      if (!relation?.id) return false;
      context.usedRelations.add(relation);
      nextRelations[record.sourceId] = {
        remoteId: relation.id,
        version: relation.version ?? 1,
        parentSourceId: record.parent,
        digest: relationDigest(record),
        pending: false,
        ...(data.receipt === undefined ? {} : { receipt: data.receipt }),
      };
      if (nextRecords[record.sourceId]?.digest !== record.digest && !contentChanged(record, priorRecords[record.sourceId])) {
        nextRecords[record.sourceId] = { ...nextRecords[record.sourceId], digest: record.digest, parentSourceId: record.parent, pending: false };
        delete nextRecords[record.sourceId].pendingDigest;
      }
      return true;
    });
  }

  const status = pendingReason ? 'pending' : sawConflict ? 'conflict' : 'applied';
  await persist(status === 'applied' ? 'clean' : status);
  return { status, applied, conflicts, ...(pendingReason ? { reason: pendingReason } : {}) };
}

/** A local change preview. It neither contacts the workspace nor updates checkpoints. */
export function previewSyncChanges(records, previous) {
  const changes = [];
  const counts = { create: 0, update: 0, relations: 0, unchanged: 0 };
  for (const record of records) {
    const prior = previous?.records?.[record.sourceId];
    const relation = relationStateFor(previous, record.sourceId);
    const action = !prior?.remoteId ? 'create'
      : prior.digest !== record.digest || prior.conflict || prior.pending ? 'update' : 'unchanged';
    const relationChanged = Boolean(record.parent || relation?.parentSourceId)
      && (!relation || relation.parentSourceId !== (record.parent ?? null) || relation.digest !== relationDigest(record) || relation.pending);
    counts[action] += 1;
    if (relationChanged) counts.relations += 1;
    if (action !== 'unchanged' || relationChanged) changes.push({ sourceId: record.sourceId, section: record.section, action, relationChanged });
  }
  return { changes, counts };
}

/** Real HTTP transport for /api/agent/v1/rpc. */
export function createHttpRpcTransport({
  endpoint = DEFAULT_RPC_ENDPOINT,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  endpoint = normalizeSyncEndpoint(endpoint);
  const transport = {
    endpoint,
    async identify(credentials) {
      const response = await transport.rpc({ version: 1, operation: 'identity', requestId: `grreat-identity-${randomUUID()}` }, credentials);
      const workspaceId = response?.ok === true ? response.data?.workspaceId : undefined;
      const destination = { endpoint, workspaceId };
      if (workspaceId !== null && !validDestination(destination)) throw new Error('Could not verify the authenticated workspace.');
      return destination;
    },
    async prepare(credentials) {
      const response = await transport.rpc({ version: 1, operation: 'query', requestId: `grreat-prepare-${randomUUID()}`, query: { type: 'snapshot' } }, credentials);
      if (response?.ok !== true) throw new Error('Could not prepare the authenticated workspace.');
    },
    async rpc(request, credentials) {
      if (!credentials?.token) throw new Error('A bearer token is required');
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${credentials.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
      let body;
      try { body = await response.json(); }
      catch { throw new Error(`Direct RPC returned non-JSON HTTP ${response.status}`); }
      if (!response.ok && (response.status >= 500 || !body || typeof body !== 'object' || body.ok !== false)) {
        const error = new Error(`Direct RPC HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body && typeof body === 'object'
        ? { ...body, httpStatus: response.status }
        : body;
    },
  };
  return transport;
}

// Explicit aliases keep the small skill API discoverable for callers that name the
// transport/parser after their conceptual job rather than the wire endpoint.
export const createRpcTransport = createHttpRpcTransport;
export const parseCanonicalMarkdown = parseCanonicalRecords;
export const syncCanonicalWorkspace = syncCanonicalRecords;

async function readRegularProjectFile(realRoot, file) {
  const candidate = resolve(realRoot, file);
  const allowedRoot = file === '../decision_log.md' ? resolve(realRoot, '..') : realRoot;
  const [metadata, realCandidate] = await Promise.all([lstat(candidate), realpath(candidate)]);
  const location = relative(allowedRoot, realCandidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error(`GRREAT canonical file must be a regular file within the project record: ${file}`);
  }
  return readFile(realCandidate, 'utf8');
}

/** Read canonical files starting with the manifest entry point. */
/** @returns {Promise<Record<string, string>>} */
export async function readCanonicalFiles(directory = 'docs/grreat') {
  const root = resolve(directory);
  const realRoot = await realpath(root);
  /** @type {Record<string, string>} */
  const files = {};
  for (const file of [...CANONICAL_FILES, '../decision_log.md']) {
    files[file === '../decision_log.md' ? 'decision_log.md' : file] = await readRegularProjectFile(realRoot, file);
  }
  parseManifest(files['README.md']);
  // Index names for vault-wide wiki links without loading journal content into sync.
  for (const file of await listVaultNotes(root)) {
    if (!Object.hasOwn(files, file)) files[file] = '';
  }
  return files;
}
