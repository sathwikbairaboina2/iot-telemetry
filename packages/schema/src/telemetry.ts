import { Ajv } from 'ajv';

export interface Telemetry {
  v: 1;
  vehicleId: string;
  seq: number;
  ts: string;
  lat: number;
  lon: number;
  speedKph: number;
  headingDeg: number;
  odometerKm: number;
  batteryPct: number;
  ignition: boolean;
}

export const telemetrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['v', 'vehicleId', 'seq', 'ts', 'lat', 'lon', 'speedKph', 'headingDeg', 'odometerKm', 'batteryPct', 'ignition'],
  properties: {
    v: { type: 'integer', const: 1 },
    vehicleId: { type: 'string', pattern: '^veh-[0-9]{4}$' },
    seq: { type: 'integer', minimum: 0 },
    ts: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lon: { type: 'number', minimum: -180, maximum: 180 },
    speedKph: { type: 'number', minimum: 0, maximum: 300 },
    headingDeg: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
    odometerKm: { type: 'number', minimum: 0 },
    batteryPct: { type: 'number', minimum: 0, maximum: 100 },
    ignition: { type: 'boolean' },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(telemetrySchema);

export type ValidationResult = { ok: true; value: Telemetry } | { ok: false; errors: string[] };

export function validateTelemetry(x: unknown): ValidationResult {
  if (validate(x)) return { ok: true, value: x as Telemetry };
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  return { ok: false, errors: errors.length > 0 ? errors : ['/ invalid'] };
}
