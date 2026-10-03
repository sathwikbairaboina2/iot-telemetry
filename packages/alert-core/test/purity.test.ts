import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const banned = [/\bDate\b/, /Math\.random/, /\bperformance\b/, /\bprocess\b/, /from ['"](node:|@aws-sdk|fs|path|crypto)/];

test('src files avoid clocks, randomness, IO and AWS', () => {
  for (const f of readdirSync(srcDir)) {
    const text = readFileSync(srcDir + f, 'utf8');
    for (const re of banned) expect(text, `${f} matches ${re}`).not.toMatch(re);
  }
});
test('package has no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  expect(pkg).not.toHaveProperty('dependencies');
});
