#!/usr/bin/env node
import { resolve } from 'node:path';
import { validateWorkspace } from './validator.mjs';
import { readCanonicalFiles } from './sync.mjs';

const directory = resolve(process.argv[2] ?? 'docs/grreat');
const files = await readCanonicalFiles(directory);
const report = validateWorkspace(files);
if (!report.valid) {
  for (const error of report.errors) console.error(`${error.code}: ${error.path ? `${error.path}: ` : ''}${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`GRREAT protocol v${report.manifest.version}: ${report.records.length} records valid`);
}
