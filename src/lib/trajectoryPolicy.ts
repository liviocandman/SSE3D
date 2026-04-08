import { PLANET_MOONS } from '@/lib/textureConfig';
import { BODY_IDS } from '@/lib/types';

export interface TrajectoryPolicyContext {
  selectedBodyId?: string | null;
  hoveredBodyId?: string | null;
}

export interface TrajectoryFetchWindow {
  fetchSpanDays: number;
  thresholdDays: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const BASELINE_PLANET_IDS = [
  BODY_IDS.MERCURY,
  BODY_IDS.VENUS,
  BODY_IDS.EARTH,
  BODY_IDS.MARS,
  BODY_IDS.JUPITER,
  BODY_IDS.SATURN,
  BODY_IDS.URANUS,
  BODY_IDS.NEPTUNE,
];

export const RAPID_MOON_IDS: ReadonlySet<string> = new Set([BODY_IDS.PHOBOS, BODY_IDS.DEIMOS]);

const MOON_PARENT_BY_ID: Record<string, string> = Object.entries(PLANET_MOONS).reduce(
  (acc, [parentId, moonIds]) => {
    moonIds.forEach((moonId) => {
      acc[moonId] = parentId;
    });
    return acc;
  },
  {} as Record<string, string>
);

export function isMoonBody(bodyId: string): boolean {
  return Boolean(MOON_PARENT_BY_ID[bodyId]);
}

export function isRapidMoonBody(bodyId: string): boolean {
  return RAPID_MOON_IDS.has(bodyId);
}

export function getMoonParentId(bodyId: string): string | undefined {
  return MOON_PARENT_BY_ID[bodyId];
}

export function getBodyFetchWindow(bodyId: string): TrajectoryFetchWindow {
  if (isRapidMoonBody(bodyId)) {
    return { fetchSpanDays: 2, thresholdDays: 0.5 };
  }
  if (isMoonBody(bodyId)) {
    return { fetchSpanDays: 7, thresholdDays: 2 };
  }
  return { fetchSpanDays: 45, thresholdDays: 20 };
}

export function getCoverageToleranceMs(bodyId: string, timeMultiplier: number): number {
  const adaptiveMs = Math.abs(timeMultiplier) * MINUTE_MS;

  if (isRapidMoonBody(bodyId)) {
    const min = 15 * MINUTE_MS;
    const max = 2 * HOUR_MS;
    return Math.max(min, Math.min(adaptiveMs, max));
  }

  if (isMoonBody(bodyId)) {
    const min = 15 * MINUTE_MS;
    const max = 6 * HOUR_MS;
    return Math.max(min, Math.min(adaptiveMs, max));
  }

  const min = 30 * MINUTE_MS;
  const max = 6 * HOUR_MS;
  return Math.max(min, Math.min(adaptiveMs, max));
}

function addFocusedBody(ids: Set<string>, bodyId: string | null | undefined, includeChildren: boolean): void {
  if (!bodyId) return;

  ids.add(bodyId);

  const parentId = getMoonParentId(bodyId);
  if (parentId) {
    ids.add(parentId);
    return;
  }

  if (includeChildren) {
    const moons = PLANET_MOONS[bodyId];
    if (moons) {
      moons.forEach((moonId) => ids.add(moonId));
    }
  }
}

export function buildContextualFetchBodyIds({
  selectedBodyId,
  hoveredBodyId,
}: TrajectoryPolicyContext): string[] {
  const ids = new Set<string>(BASELINE_PLANET_IDS);

  // Focused context may include direct children.
  addFocusedBody(ids, selectedBodyId, true);

  // Hover context includes hovered body only (plus parent if hovered is moon).
  addFocusedBody(ids, hoveredBodyId, false);

  return Array.from(ids);
}

export function buildTrajectoryRequestKey(
  date: string,
  spanDays: number,
  ids: string[],
  tier?: string
): string {
  const normalizedIds = Array.from(new Set(ids)).sort();
  const normalizedTier = tier ?? 'mid';
  return `${date}|${spanDays}|${normalizedTier}|${normalizedIds.join(',')}`;
}
