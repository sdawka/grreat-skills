#!/usr/bin/env node

import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateWorkspace } from './validator.mjs';
import {
  createFileStateStore,
  createHttpRpcTransport,
  parseCanonicalRecords,
  readCanonicalFiles,
  syncCanonicalRecords,
} from './sync.mjs';
import { readAccessToken } from './auth.mjs';

/**
 * Validate canonical Markdown and sync only changed records through direct RPC.
 * Dependencies are injectable so the CLI boundary can be contract-tested without
 * persisting credentials or making a network request.
 */
export async function runSync({
  directory = 'docs/grreat',
  endpoint = process.env.GRREAT_RPC_URL,
  batchSize = 25,
  retries = 2,
  dryRun = false,
  bindExisting,
  readFiles = readCanonicalFiles,
  readToken = readAccessToken,
  transport = /** @type {import('./sync.mjs').RpcTransport} */ (createHttpRpcTransport({ endpoint })),
  stateStore = createFileStateStore(resolve(directory, '.sync.json')),
  env = process.env,
} = {}) {
  const files = await readFiles(directory);
  const report = validateWorkspace(files);
  if (!report.valid) {
    return {
      status: 'invalid',
      applied: 0,
      conflicts: [],
      errors: report.errors,
    };
  }
  const sourceRoot = directory.replace(/\\/gu, '/').replace(/\/$/u, '') || 'docs/grreat';
  const records = parseCanonicalRecords(files, { sourceRoot });
  const token = await readToken({ env });
  const result = await syncCanonicalRecords({
    records,
    credentials: token ? { token } : undefined,
    transport,
    batchSize,
    retries,
    stateStore,
    sourceRoot,
    dryRun,
    bindExisting,
  });
  return { ...result, recordCount: records.length };
}

export function syncExitCode(result) {
  return ['clean', 'applied', 'no-op', 'preview'].includes(result?.status) ? 0 : result?.status === 'conflict' ? 2 : 1;
}

export function optionsFromArgv(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (!['--directory', '--endpoint', '--batch-size', '--retries', '--bind-existing'].includes(argument)) throw new Error(`Unknown sync option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value; no sync was started.`);
    if (argument === '--directory') options.directory = value;
    else if (argument === '--endpoint') options.endpoint = value;
    else if (argument === '--bind-existing') options.bindExisting = value;
    else {
      const number = Number(value);
      if (!Number.isInteger(number) || number < (argument === '--retries' ? 0 : 1) || (argument === '--batch-size' && number > 25)) throw new Error(`Invalid value for ${argument}; no sync was started.`);
      if (argument === '--batch-size') options.batchSize = number;
      else options.retries = number;
    }
  }
  return options;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  const options = optionsFromArgv(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node sync-cli.mjs [--directory docs/grreat] [--endpoint URL] [--dry-run] [--bind-existing WORKSPACE_ID] [--batch-size 25] [--retries 2]');
  } else {
    const result = await runSync(options);
    if (result.status === 'invalid') {
      for (const error of result.errors) console.error(`${error.code}: ${error.message}`);
      process.exitCode = syncExitCode(result);
    } else {
      console.log(JSON.stringify(result));
      process.exitCode = syncExitCode(result);
    }
  }
}
