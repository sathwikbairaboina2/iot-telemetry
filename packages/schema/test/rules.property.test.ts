import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { classifyTelemetry, evaluateWhere, whereClause, loadFixtures, validateTelemetry,
  TELEMETRY_TO_HISTORY_SQL, INVALID_TO_QUARANTINE_SQL, POSITION_TO_LOCATION_SQL } from '../src/index.js';

const topicFor = (p: unknown) => {
  const id = (p as { vehicleId?: unknown })?.vehicleId;
  return `fleet/${typeof id === 'string' ? id : 'veh-0000'}/telemetry`;
};

describe('shared rule SQL', () => {
  test.each(loadFixtures('valid'))('valid fixture $name goes to history and location', ({ topic, payload }) => {
    expect(evaluateWhere(whereClause(TELEMETRY_TO_HISTORY_SQL), payload, { topic })).toBe(true);
    expect(evaluateWhere(whereClause(POSITION_TO_LOCATION_SQL), payload, { topic })).toBe(true);
    expect(evaluateWhere(whereClause(INVALID_TO_QUARANTINE_SQL), payload, { topic })).toBe(false);
  });
  const ruleInvalid = ['missing-lat', 'lat-out-of-range', 'lat-string', 'wrong-version', 'bad-ts', 'vehicle-mismatch'];
  test.each(loadFixtures('invalid').filter((f) => ruleInvalid.includes(f.name)))('invalid fixture $name is quarantined', ({ topic, payload }) => {
    expect(classifyTelemetry(topic, payload)).toBe('quarantine');
  });
  test('extra-field passes the coarse SQL gate (ajv catches it)', () => {
    const f = loadFixtures('invalid').find((x) => x.name === 'extra-field')!;
    expect(classifyTelemetry(f.topic, f.payload)).toBe('valid');
  });
  test('VALID and NOT VALID are exact complements for arbitrary JSON', () => {
    fc.assert(fc.property(fc.jsonValue(), (payload) => {
      const topic = topicFor(payload);
      const a = evaluateWhere(whereClause(TELEMETRY_TO_HISTORY_SQL), payload, { topic });
      const b = evaluateWhere(whereClause(INVALID_TO_QUARANTINE_SQL), payload, { topic });
      expect(a !== b).toBe(true);
    }), { numRuns: 2000 });
  });
  test('every schema-valid telemetry is SQL-valid', () => {
    const arb = fc.record({
      v: fc.constant(1 as const), vehicleId: fc.integer({ min: 0, max: 9999 }).map((n) => `veh-${String(n).padStart(4, '0')}`),
      seq: fc.nat(), ts: fc.integer({ min: 1, max: 4102444800000 }).map((ms) => new Date(ms).toISOString()),
      lat: fc.double({ min: -90, max: 90, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }),
      speedKph: fc.double({ min: 0, max: 300, noNaN: true }), headingDeg: fc.double({ min: 0, max: 359.99, noNaN: true }),
      odometerKm: fc.double({ min: 0, max: 1e6, noNaN: true }), batteryPct: fc.double({ min: 0, max: 100, noNaN: true }), ignition: fc.boolean(),
    });
    fc.assert(fc.property(arb, (t) => {
      expect(validateTelemetry(t).ok).toBe(true);
      expect(classifyTelemetry(`fleet/${t.vehicleId}/telemetry`, t)).toBe('valid');
    }), { numRuns: 1000 });
  });
});
