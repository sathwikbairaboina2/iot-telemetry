import { describe, expect, test } from 'vitest';
import { evaluateExpression, evaluateWhere, UNDEFINED } from '../src/index.js';
const ctx = { topic: 'fleet/veh-0042/telemetry' };
const ev = (e: string, p: unknown = {}) => evaluateExpression(e, p, ctx);

describe('IoT SQL subset', () => {
  test('missing field compares to Undefined', () => { expect(ev('lat >= -90')).toBe(UNDEFINED); });
  test('AND does not short-circuit Undefined', () => { expect(ev('false AND lat >= 0')).toBe(UNDEFINED); });
  test('mismatched = is false, mismatched <> is true', () => {
    expect(ev("v = 1", { v: '1' })).toBe(false);
    expect(ev("v <> 1", { v: '1' })).toBe(true);
  });
  test('numeric strings convert for ordering', () => { expect(ev('lat >= 10', { lat: '48.1' })).toBe(true); });
  test('non-numeric strings make ordering Undefined', () => { expect(ev('lat >= 10', { lat: 'abc' })).toBe(UNDEFINED); });
  test('topic(n)', () => { expect(ev('topic(2)')).toBe('veh-0042'); expect(ev('topic(9)')).toBe(UNDEFINED); });
  test('time_to_epoch parses the payload format', () => {
    expect(ev(`time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX")`, { ts: '2026-10-04T08:00:00.000Z' })).toBe(1791100800000);
  });
  test('get_or_default catches Undefined and failures', () => {
    expect(ev('get_or_default(lat >= 0, false)')).toBe(false);
    expect(ev(`get_or_default(time_to_epoch(ts, "yyyy-MM-dd'T'HH:mm:ss.SSSX") > 0, false)`, { ts: 'nope' })).toBe(false);
  });
  test('WHERE matches only Boolean true', () => {
    expect(evaluateWhere('lat >= 0', {}, ctx)).toBe(false);
    expect(evaluateWhere('NOT (lat >= 0)', {}, ctx)).toBe(false);
  });
});
