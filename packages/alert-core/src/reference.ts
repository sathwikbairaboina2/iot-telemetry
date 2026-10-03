import type { AlertConfig, AlertType, GeofenceEvent } from './types.js';

export interface ReferenceAlert { type: AlertType; confirmedAt: number }

interface Segment { inside: boolean; start: number; end: number }

/**
 * Test oracle, written as raw segments on purpose (it does not call step()): dedupe by eventId, sort by device time,
 * build inside/outside segments up to a horizon, then keep only the segments that last long enough.
 */
export function referenceAlerts(events: readonly GeofenceEvent[], horizon: number, config: AlertConfig): ReferenceAlert[] {
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.eventId) ? false : (seen.add(e.eventId), true)));
  const sorted = unique
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.deviceTs - b.e.deviceTs || a.i - b.i)
    .map((x) => x.e);

  const segments: Segment[] = [];
  let cur: Segment = { inside: false, start: -Infinity, end: -Infinity };
  for (const e of sorted) {
    const wantInside = e.kind === 'ENTER';
    if (wantInside === cur.inside) continue;
    cur.end = e.deviceTs;
    segments.push(cur);
    cur = { inside: wantInside, start: e.deviceTs, end: e.deviceTs };
  }
  cur.end = horizon;
  segments.push(cur);

  const out: ReferenceAlert[] = [];
  let confirmed = false;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (seg.inside && !confirmed && len >= config.dwellMs) {
      out.push({ type: 'ENTERED', confirmedAt: seg.start + config.dwellMs });
      confirmed = true;
    } else if (!seg.inside && confirmed && len >= config.minExitMs) {
      out.push({ type: 'EXITED', confirmedAt: seg.start + config.minExitMs });
      confirmed = false;
    }
  }
  return out;
}
