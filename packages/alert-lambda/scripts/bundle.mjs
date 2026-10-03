import { build } from 'esbuild';

await build({
  entryPoints: ['src/lambda.ts'], outfile: 'dist-lambda/index.mjs', bundle: true, platform: 'node', target: 'node24',
  format: 'esm', conditions: ['source'], external: ['@aws-sdk/*'], minify: false, sourcemap: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log('bundled dist-lambda/index.mjs');
