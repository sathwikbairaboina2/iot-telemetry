import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Fixture { name: string; topic: string; payload: unknown }

export function loadFixtures(kind: 'valid' | 'invalid'): Fixture[] {
  const dir = fileURLToPath(new URL(`../fixtures/${kind}/`, import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const j = JSON.parse(readFileSync(dir + f, 'utf8')) as { topic: string; payload: unknown };
      return { name: f.replace(/\.json$/, ''), topic: j.topic, payload: j.payload };
    });
}
