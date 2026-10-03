import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('bundle script writes dist-lambda/index.mjs with a handler export and external AWS SDK', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['scripts/bundle.mjs'], { cwd });
  const out = cwd + 'dist-lambda/index.mjs';
  expect(existsSync(out)).toBe(true);
  const text = readFileSync(out, 'utf8');
  expect(text).toMatch(/export\s*\{[^}]*\bhandler\b/);
  expect(text).not.toContain('@aws-sdk/client-dynamodb/dist');
}, 30_000);
