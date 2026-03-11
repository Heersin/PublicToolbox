import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const generatedSubmodsRoot = path.resolve(repoRoot, 'apps', 'tools-web', '.generated-submods');

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

function serveGeneratedSubmodsPlugin(): Plugin {
  return {
    name: 'serve-generated-submods',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/')) {
          next();
          return;
        }

        const normalized = url.slice(1);
        const mount = normalized.split('/')[0];
        if (!mount) {
          next();
          return;
        }

        const mountRoot = path.join(generatedSubmodsRoot, mount);
        if (!fs.existsSync(mountRoot) || !fs.statSync(mountRoot).isDirectory()) {
          next();
          return;
        }

        if (url === `/${mount}`) {
          res.statusCode = 302;
          res.setHeader('Location', `/${mount}/`);
          res.end();
          return;
        }

        const relativePath = decodeURIComponent(normalized.slice(mount.length + 1));
        const requestedPath = path.resolve(mountRoot, relativePath || 'index.html');
        const safePath = requestedPath.startsWith(mountRoot)
          ? requestedPath
          : path.join(mountRoot, 'index.html');

        let filePath = safePath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          filePath = path.join(mountRoot, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          next();
          return;
        }

        const contentType = contentTypeFor(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.end(fs.readFileSync(filePath));
      });
    },
  };
}

function resolveFsAllowList(): string[] {
  const allowList = [repoRoot];
  const extra = process.env.TOOLS_WEB_FS_ALLOW?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  for (const item of extra) {
    allowList.push(path.resolve(item));
  }

  return allowList;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [serveGeneratedSubmodsPlugin(), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
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
