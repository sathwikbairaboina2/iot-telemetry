import { describe, expect, test } from 'vitest';
import { validateTelemetry, loadFixtures } from '../src/index.js';

describe('validateTelemetry', () => {
  test.each(loadFixtures('valid'))('accepts $name', ({ payload }) => {
    expect(validateTelemetry(payload)).toEqual({ ok: true, value: payload });
  });
  const schemaInvalid = loadFixtures('invalid').filter((f) => f.name !== 'vehicle-mismatch');
  test.each(schemaInvalid)('rejects $name', ({ payload }) => {
    const r = validateTelemetry(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
  test('vehicle-mismatch is schema-valid (the topic check lives in rule SQL)', () => {
    const f = loadFixtures('invalid').find((x) => x.name === 'vehicle-mismatch')!;
    expect(validateTelemetry(f.payload).ok).toBe(true);
  });
  test('headingDeg 360 is rejected (exclusive max)', () => {
    const base = loadFixtures('valid')[0]!.payload as Record<string, unknown>;
    expect(validateTelemetry({ ...base, headingDeg: 360 }).ok).toBe(false);
  });
});
