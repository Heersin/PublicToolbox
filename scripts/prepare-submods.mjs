#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const registryDir = path.join(repoRoot, 'registry', 'tools');
const submodsRoot = path.join(repoRoot, 'submods');
const outRoot = path.join(repoRoot, 'apps', 'tools-web', '.generated-submods');

const textExtensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.xml']);

function normalizeExternalHref(href, sourceFile) {
  if (typeof href !== 'string' || !href.startsWith('/')) {
    throw new Error(`external_href must start with "/" in ${sourceFile}`);
  }

  const pathname = href.split('?')[0].split('#')[0];
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  if (!slug || slug.includes('/')) {
    throw new Error(`external_href must be one-level route like /toolX/ in ${sourceFile}`);
  }
  return slug;
}

function rewriteQuotedAbsolutePath(target, mountSlug) {
  if (
    target.startsWith(`${mountSlug}/`) ||
    target.startsWith('api/') ||
    target.startsWith('@fs/') ||
    target.startsWith('@id/')
  ) {
    return `/${target}`;
  }
  return `/${mountSlug}/${target}`;
}

function rewriteAbsolutePaths(content, mountSlug, ext) {
  let rewritten = content.replace(/(["'`])\/(?!\/)([^"'`\r\n]+?)\1/g, (_, quote, target) => {
    return `${quote}${rewriteQuotedAbsolutePath(target, mountSlug)}${quote}`;
  });

  if (ext === '.css') {
    rewritten = rewritten.replace(/url\(\s*\/(?!\/)([^)\s]+)\s*\)/g, (_, target) => {
      return `url(${rewriteQuotedAbsolutePath(target, mountSlug)})`;
    });
    rewritten = rewritten.replace(/url\(\s*(["'])\/(?!\/)([^"')]+)\1\s*\)/g, (_, quote, target) => {
      return `url(${quote}${rewriteQuotedAbsolutePath(target, mountSlug)}${quote})`;
    });
  }

  return rewritten;
}

async function copyAndRewriteTree(sourceDir, targetDir, mountSlug) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyAndRewriteTree(src, dst, mountSlug);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (textExtensions.has(ext)) {
      const raw = await fs.readFile(src, 'utf-8');
      const rewritten = rewriteAbsolutePaths(raw, mountSlug, ext);
      await fs.writeFile(dst, rewritten, 'utf-8');
      continue;
    }

    await fs.copyFile(src, dst);
  }
}

async function loadExternalToolMounts() {
  const files = (await fs.readdir(registryDir))
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort();

  const mounts = [];
  const seen = new Set();

  for (const file of files) {
    const sourceFile = path.join(registryDir, file);
    const raw = await fs.readFile(sourceFile, 'utf-8');
    const manifest = parse(raw);
    if (!manifest || typeof manifest.external_href !== 'string') {
      continue;
    }

    const mount = normalizeExternalHref(manifest.external_href, sourceFile);
    if (seen.has(mount)) {
      throw new Error(`Duplicate external route "/${mount}/" in ${sourceFile}`);
    }
    seen.add(mount);
    mounts.push({ id: String(manifest.id), mount });
  }

  return mounts;
}

async function main() {
  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true });

  const mounts = await loadExternalToolMounts();
  for (const item of mounts) {
    const sourceDir = path.join(submodsRoot, item.mount);
    const sourceStat = await fs.stat(sourceDir).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error(`Missing submods directory for ${item.id}: submods/${item.mount}`);
    }

    const targetDir = path.join(outRoot, item.mount);
    await copyAndRewriteTree(sourceDir, targetDir, item.mount);
  }

  process.stdout.write(`Prepared ${mounts.length} external submod(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
