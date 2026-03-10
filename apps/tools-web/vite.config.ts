import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const colorSubmodDir = path.resolve(repoRoot, 'submods', 'colorcard');
const siblingColorCardDir = path.resolve(repoRoot, '../colorCard');

function textRewrite(source: string): string {
  return source.replaceAll('/colorcard/', '/color/');
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function serveColorSubmodPlugin(): Plugin {
  return {
    name: 'serve-color-submod',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/color' && !url.startsWith('/color/')) {
          next();
          return;
        }

        if (url === '/color') {
          res.statusCode = 302;
          res.setHeader('Location', '/color/');
          res.end();
          return;
        }

        if (!fs.existsSync(colorSubmodDir)) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(url.slice('/color/'.length));
        const requestedPath = path.resolve(colorSubmodDir, relativePath || 'index.html');
        const safePath = requestedPath.startsWith(colorSubmodDir)
          ? requestedPath
          : path.join(colorSubmodDir, 'index.html');

        let filePath = safePath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          filePath = path.join(colorSubmodDir, 'index.html');
        }

        const contentType = contentTypeFor(filePath);
        const isText = contentType.startsWith('text/') || contentType.includes('json');
        const content = fs.readFileSync(filePath);
        const body = isText ? Buffer.from(textRewrite(content.toString('utf-8'))) : content;

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.end(body);
      });
    },
  };
}

function resolveFsAllowList(): string[] {
  const allowList = [repoRoot];
  if (fs.existsSync(siblingColorCardDir)) {
    allowList.push(siblingColorCardDir);
  }

  const extra = process.env.TOOLS_WEB_FS_ALLOW?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  for (const item of extra) {
    allowList.push(path.resolve(item));
  }

  return allowList;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [serveColorSubmodPlugin(), react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.TOOLS_API_PROXY_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
    fs: {
      allow: resolveFsAllowList(),
    },
  },
});
