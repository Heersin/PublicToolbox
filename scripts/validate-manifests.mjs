#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'schemas', 'tool-manifest.schema.json');
const registryDir = path.join(repoRoot, 'registry', 'tools');

async function main() {
  const schemaRaw = await fs.readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const files = (await fs.readdir(registryDir))
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort();

  if (files.length === 0) {
    throw new Error('no tool manifests found under registry/tools');
  }

  let invalidCount = 0;
  for (const file of files) {
    const absPath = path.join(registryDir, file);
    const raw = await fs.readFile(absPath, 'utf8');
    const data = parse(raw);
    const valid = validate(data);

    if (!valid) {
      invalidCount += 1;
      const issues = (validate.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message ?? 'validation error'}`)
        .join('; ');
      process.stderr.write(`INVALID ${file}: ${issues}\n`);
    }
  }

  if (invalidCount > 0) {
    throw new Error(`${invalidCount} manifest(s) failed schema validation`);
  }

  process.stdout.write(`Validated ${files.length} manifest(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
