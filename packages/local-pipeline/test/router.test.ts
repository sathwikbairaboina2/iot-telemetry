import { describe, expect, test } from 'vitest';
import { loadFixtures } from '@iot-telemetry/schema';
import { routeMessage } from '../src/index.js';

const enc = (x: unknown) => JSON.stringify(x);

describe('routeMessage', () => {
  test.each(loadFixtures('valid'))('valid fixture $name', ({ topic, payload }) => {
    const r = routeMessage(topic, enc(payload));
    expect(r).toMatchObject({ kind: 'valid', schemaErrors: [] });
  });
  test('extra-field passes the SQL gate but carries schema errors', () => {
    const f = loadFixtures('invalid').find((x) => x.name === 'extra-field')!;
    const r = routeMessage(f.topic, enc(f.payload));
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect(r.schemaErrors.length).toBeGreaterThan(0);
  });
  const ruleInvalid = ['missing-lat', 'lat-out-of-range', 'lat-string', 'wrong-version', 'bad-ts', 'vehicle-mismatch'];
  test.each(loadFixtures('invalid').filter((f) => ruleInvalid.includes(f.name)))('invalid fixture $name is quarantined', ({ topic, payload }) => {
    expect(routeMessage(topic, enc(payload))).toMatchObject({ kind: 'quarantine', reason: 'rule_sql', raw: payload });
  });
  test('broken JSON is quarantined as invalid_json', () => {
    expect(routeMessage('fleet/veh-0001/telemetry', '{not json')).toMatchObject({ kind: 'quarantine', reason: 'invalid_json', raw: '{not json' });
  });
  test('Uint8Array payloads work', () => {
    const f = loadFixtures('valid')[0]!;
    expect(routeMessage(f.topic, new TextEncoder().encode(enc(f.payload))).kind).toBe('valid');
  });
});
