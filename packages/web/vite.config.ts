import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// MapLibre 6 runs in a module worker that imports a sibling "shared" file by its plain name. Vite would hash one and
// drop the other, so both are served (dev) and emitted (build) under fixed names.
const require = createRequire(import.meta.url);
const mlDist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

function maplibreWorker(): Plugin {
  return {
    name: 'maplibre-worker-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = WORKER_FILES.find((f) => req.url?.split('?')[0] === `/maplibre/${f}`);
        if (!name) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(join(mlDist, name)));
      });
    },
    generateBundle() {
      for (const f of WORKER_FILES) this.emitFile({ type: 'asset', fileName: `maplibre/${f}`, source: readFileSync(join(mlDist, f)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), maplibreWorker()],
  resolve: { conditions: ['source', 'browser', 'module', 'import', 'default'] },
  ssr: { resolve: { conditions: ['source'] } },
  server: { port: 5373, strictPort: true, host: true },
  preview: { port: 5373, strictPort: true, host: true, allowedHosts: true },
  test: { include: ['test/**/*.test.ts'] },
});
