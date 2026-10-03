import { expect, test } from 'vitest';
import { parseCli } from '../src/cli.js';

test('run command with flags and defaults', () => {
  expect(parseCli(['run', '--count', '3', '--scenario', 'loiter'], {})).toMatchObject({
    command: 'run', count: 3, scenarios: ['loiter'], hz: 1, durationS: 0, seed: 42, broker: 'mqtt://localhost:5370',
  });
});
test('env supplies defaults when flags are absent', () => {
  expect(parseCli(['run'], { SIM_COUNT: '7', SIM_SCENARIOS: 'tunnel', MQTT_URL: 'mqtt://x:1' })).toMatchObject({
    count: 7, scenarios: ['tunnel'], broker: 'mqtt://x:1',
  });
});
test('record and replay', () => {
  expect(parseCli(['record'], {})).toMatchObject({ command: 'record', count: 5, durationS: 400, scenarios: ['loiter'] });
  expect(parseCli(['replay', '--speed', '5'], {})).toMatchObject({ command: 'replay', speed: 5 });
});
test('unknown command and bad scenario throw', () => {
  expect(() => parseCli(['dance'], {})).toThrow('Unknown command');
  expect(() => parseCli(['run', '--scenario', 'bogus'], {})).toThrow('Unknown scenario');
});
