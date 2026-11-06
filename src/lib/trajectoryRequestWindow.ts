import { isMoonBody } from './trajectoryPolicy';

export const TRAJECTORY_DAY_MS = 86_400_000;

function startsAtRequestDate(bodyId: string): boolean {
  // Mirrors spice_windows._resolve_window for dynamic (not full-orbit) data.
  return bodyId === '10' || isMoonBody(bodyId);
}

export function trajectoryRequestDate(bodyId: string, startMs: number, spanDays: number): string {
  const anchorMs = startsAtRequestDate(bodyId) ? startMs : startMs + spanDays * TRAJECTORY_DAY_MS;
  return new Date(anchorMs).toISOString().split('T')[0];
}

export function trajectoryRequestWindow(bodyId: string, date: string, spanDays: number) {
  const anchorMs = Date.parse(`${date}T00:00:00Z`);
  const spanMs = spanDays * TRAJECTORY_DAY_MS;
  return startsAtRequestDate(bodyId)
    ? { startMs: anchorMs, endMs: anchorMs + spanMs }
    : { startMs: anchorMs - spanMs, endMs: anchorMs };
}
