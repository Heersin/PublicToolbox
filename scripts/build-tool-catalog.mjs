#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const registryDir = path.join(repoRoot, 'registry', 'tools');

const reservedSlugs = new Set(['api', 'assets', 'static', 'favicon.ico']);

function stableSortBySlug(a, b) {
  return a.slug.localeCompare(b.slug, 'en');
}

function assertManifestShape(manifest, sourceFile) {
  const required = [
    'id',
    'slug',
    'name',
    'description',
    'tags',
    'version',
    'execution_mode',
    'input_schema',
    'output_schema',
  ];

  for (const key of required) {
    if (!(key in manifest)) {
      throw new Error(`Missing required field "${key}" in ${sourceFile}`);
    }
  }

  if (reservedSlugs.has(String(manifest.slug))) {
    throw new Error(`Tool slug "${manifest.slug}" in ${sourceFile} is reserved`);
  }

  const mode = String(manifest.execution_mode);
  if (!['client-wasm', 'server-api', 'hybrid'].includes(mode)) {
    throw new Error(`Invalid execution_mode "${mode}" in ${sourceFile}`);
  }
}

async function loadManifests() {
  const files = (await fs.readdir(registryDir))
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort();

  if (files.length === 0) {
    throw new Error('No manifests found under registry/tools');
  }

  const manifests = [];
  const seenIds = new Set();
  const seenSlugs = new Set();

  for (const file of files) {
    const absPath = path.join(registryDir, file);
    const raw = await fs.readFile(absPath, 'utf-8');
    const parsed = parse(raw);

    assertManifestShape(parsed, absPath);

    if (seenIds.has(parsed.id)) {
      throw new Error(`Duplicate tool id "${parsed.id}" in ${absPath}`);
    }
    if (seenSlugs.has(parsed.slug)) {
      throw new Error(`Duplicate tool slug "${parsed.slug}" in ${absPath}`);
    }

    seenIds.add(parsed.id);
    seenSlugs.add(parsed.slug);

    manifests.push(parsed);
  }

  manifests.sort(stableSortBySlug);
  return manifests;
}

function toTypeScriptModule(manifests) {
  return `/* AUTO-GENERATED FILE. DO NOT EDIT MANUALLY. */\n` +
    `export type ExecutionMode = 'client-wasm' | 'server-api' | 'hybrid';\n\n` +
    `export interface ToolManifest {\n` +
    `  id: string;\n` +
    `  slug: string;\n` +
    `  name: string;\n` +
    `  description: string;\n` +
    `  tags: string[];\n` +
    `  version: string;\n` +
    `  execution_mode: ExecutionMode;\n` +
    `  input_schema: string;\n` +
    `  output_schema: string;\n` +
    `  wasm_entry?: string;\n` +
    `  api_endpoint?: string;\n` +
    `}\n\n` +
    `export const toolManifests: ToolManifest[] = ${JSON.stringify(manifests, null, 2)};\n`;
}

async function main() {
  const manifests = await loadManifests();

  const webOutPath = path.join(repoRoot, 'apps', 'tools-web', 'src', 'generated', 'tool-manifests.ts');
  await fs.mkdir(path.dirname(webOutPath), { recursive: true });
  await fs.writeFile(webOutPath, toTypeScriptModule(manifests), 'utf-8');

  const apiOutPath = path.join(repoRoot, 'services', 'tools-api', 'config', 'tool-manifests.json');
  await fs.mkdir(path.dirname(apiOutPath), { recursive: true });
  await fs.writeFile(apiOutPath, JSON.stringify(manifests, null, 2), 'utf-8');

  process.stdout.write(`Generated catalog for ${manifests.length} tool(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
