import type { Alert } from '@iot-telemetry/alert-core';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function AlertTimeline({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="empty">
        No alerts yet. A vehicle must stay inside a geofence for 60 seconds before an ENTERED alert is confirmed.
      </p>
    );
  }
  return (
    <ol className="timeline">
      {alerts.map((a) => (
        <li key={a.alertId} className="alert-row" data-testid="alert-row">
          <span className={`chip chip-${a.type.toLowerCase()}`}>{a.type}</span>
          <span className="alert-who">{a.vehicleId}</span>
          <span className="alert-where">{a.geofenceId}</span>
          <time className="alert-time" dateTime={new Date(a.confirmedAt).toISOString()}>{timeFmt.format(a.confirmedAt)}</time>
        </li>
      ))}
    </ol>
  );
}
