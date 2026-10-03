import { useEffect, useReducer, useRef, useState } from 'react';
import { AlertTimeline } from './AlertTimeline.js';
import { DEFAULT_MQTT_URL, connectFeed, mqttUrlFromLocation, type ConnState } from './feed.js';
import { FleetMap } from './FleetMap.js';
import { fleetReducer, initialFleetState } from './state.js';

const CONN_LABEL: Record<ConnState, string> = { connecting: 'connecting', live: 'live', offline: 'offline' };

export function App() {
  const [state, dispatch] = useReducer(fleetReducer, initialFleetState);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [rate, setRate] = useState(0);
  const messages = useRef(0);
  messages.current = state.messages;

  useEffect(() => connectFeed(mqttUrlFromLocation(window.location.search, DEFAULT_MQTT_URL), dispatch, setConn), []);

  // messages per second over a rolling 5 s window
  useEffect(() => {
    const samples: Array<[number, number]> = [];
    const id = window.setInterval(() => {
      const now = Date.now();
      samples.push([now, messages.current]);
      while (samples.length > 1 && now - samples[0]![0] > 5000) samples.shift();
      const first = samples[0]!;
      const dt = (now - first[0]) / 1000;
      setRate(dt > 0 ? (messages.current - first[1]) / dt : 0);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch({ type: 'select', vehicleId: null }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const vehicles = Object.values(state.vehicles);
  const online = vehicles.filter((v) => v.online).length;
  const last = state.alerts[0];
  const selected = state.selected ? state.vehicles[state.selected] : undefined;

  return (
    <div className="shell">
      <FleetMap state={state} onSelect={(id) => dispatch({ type: 'select', vehicleId: id })} />
      <aside className="panel">
        <header className="panel-head">
          <h1>Fleet telemetry</h1>
          <span className={`badge badge-${conn}`} data-testid="conn-status">{CONN_LABEL[conn]}</span>
        </header>

        <dl className="stats">
          <div><dt>Vehicles</dt><dd data-testid="vehicle-count">{vehicles.length}</dd></div>
          <div><dt>Online</dt><dd>{online}</dd></div>
          <div><dt>Messages/s</dt><dd>{rate.toFixed(1)}</dd></div>
        </dl>

        {selected ? (
          <section className="selected" aria-label="Selected vehicle">
            <h2>{selected.telemetry.vehicleId}</h2>
            <p>
              {selected.telemetry.speedKph.toFixed(0)} km/h, battery {selected.telemetry.batteryPct.toFixed(0)}%,
              {selected.online ? ' online' : ' offline'}
            </p>
            <button type="button" onClick={() => dispatch({ type: 'select', vehicleId: null })}>Clear (Esc)</button>
          </section>
        ) : null}

        <section aria-label="Alerts">
          <h2>Alerts</h2>
          {last ? <p className="last-alert">Last: {last.type} {last.vehicleId}</p> : null}
          <AlertTimeline alerts={state.alerts} />
        </section>
      </aside>
    </div>
  );
}
