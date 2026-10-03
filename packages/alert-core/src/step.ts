import type { Alert, AlertConfig, AlertType, CoreEvent, PairState, StepOutcome, StepResult } from './types.js';

function makeAlert(type: AlertType, confirmedAt: number, ev: CoreEvent): Alert {
  return {
    alertId: `${ev.vehicleId}:${ev.geofenceId}:${type}:${confirmedAt}`,
    type, vehicleId: ev.vehicleId, geofenceId: ev.geofenceId, confirmedAt,
    triggerEventId: ev.kind === 'TICK' ? null : ev.eventId,
  };
}

function confirm(s: PairState, at: number, cfg: AlertConfig, ev: CoreEvent): { s: PairState; alert: Alert | null } {
  if (s.since === null) return { s, alert: null };
  if (s.status === 'PENDING_IN' && at - s.since >= cfg.dwellMs) {
    const confirmedAt = s.since + cfg.dwellMs;
    return { s: { ...s, status: 'INSIDE', since: confirmedAt }, alert: makeAlert('ENTERED', confirmedAt, ev) };
  }
  if (s.status === 'PENDING_OUT' && at - s.since >= cfg.minExitMs) {
    const confirmedAt = s.since + cfg.minExitMs;
    return { s: { ...s, status: 'OUTSIDE', since: confirmedAt }, alert: makeAlert('EXITED', confirmedAt, ev) };
  }
  return { s, alert: null };
}

export function step(state: PairState, ev: CoreEvent, cfg: AlertConfig): StepResult {
  if (state.lastEventTs !== null && ev.deviceTs < state.lastEventTs) return { state, emitted: [], outcome: 'late_ignored' };
  if (ev.kind !== 'TICK' && ev.deviceTs === state.lastEventTs && state.idsAtLastTs.includes(ev.eventId)) {
    return { state, emitted: [], outcome: 'duplicate' };
  }
  const emitted: Alert[] = [];
  let { s, alert } = confirm(state, ev.deviceTs, cfg, ev);
  if (alert) emitted.push(alert);
  if (ev.kind === 'TICK') return { state: s, emitted, outcome: 'tick' };

  const since = Math.max(ev.deviceTs, s.since ?? ev.deviceTs);
  let outcome: StepOutcome = 'applied';
  if (ev.kind === 'ENTER') {
    if (s.status === 'OUTSIDE') s = { ...s, status: 'PENDING_IN', since };
    else if (s.status === 'PENDING_OUT') s = { ...s, status: 'INSIDE', since };
    else outcome = 'redundant';
  } else {
    if (s.status === 'INSIDE') s = { ...s, status: 'PENDING_OUT', since };
    else if (s.status === 'PENDING_IN') s = { ...s, status: 'OUTSIDE', since };
    else outcome = 'redundant';
  }
  const idsAtLastTs = ev.deviceTs === s.lastEventTs ? [...s.idsAtLastTs, ev.eventId] : [ev.eventId];
  s = { ...s, lastEventTs: ev.deviceTs, idsAtLastTs };
  ({ s, alert } = confirm(s, ev.deviceTs, cfg, ev));
  if (alert) emitted.push(alert);
  return { state: s, emitted, outcome };
}
