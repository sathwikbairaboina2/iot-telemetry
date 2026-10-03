import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source', 'browser', 'module', 'import', 'default'] },
  ssr: { resolve: { conditions: ['source'] } },
  server: { port: 5373, strictPort: true, host: true },
  preview: { port: 5373, strictPort: true, host: true },
  test: { include: ['test/**/*.test.ts'] },
});
