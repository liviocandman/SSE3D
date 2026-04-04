import type { MissionPosition, MissionVelocity } from '@/lib/missionTypes';

const EARTH_MEAN_RADIUS_KM = 6_371;
const SPEED_OF_LIGHT_KM_S = 299_792.458;

function formatNumber(num: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(num);
}

export function formatMissionMET(elapsed: string): string {
  if (!elapsed) return 'T+ 00:00:00:00';
  if (elapsed.startsWith('T+')) return elapsed;

  const [daysPart = '0', timePart = '00:00:00'] = elapsed.split('-');
  const dayCount = Number.parseInt(daysPart, 10);
  const [hoursRaw = '0', minutesRaw = '0', secondsRaw = '0'] = timePart.split(':');

  const pad2 = (value: string | number) => String(value).padStart(2, '0');
  const safeDays = Number.isFinite(dayCount) ? Math.max(dayCount, 0) : 0;

  return `T+ ${pad2(safeDays)}:${pad2(hoursRaw)}:${pad2(minutesRaw)}:${pad2(secondsRaw)}`;
}

export function formatDistanceKm(distanceKm: number, decimals = 0): string {
  return formatNumber(distanceKm, decimals);
}

export function formatVelocityKmH(velocity: MissionVelocity): string {
  const magnitudeKmS = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
  return formatNumber(magnitudeKmS * 3600);
}

export function formatSignalLatency(earthDistanceKm: number): string {
  const delaySeconds = earthDistanceKm / SPEED_OF_LIGHT_KM_S;

  if (delaySeconds < 10) {
    return `${formatNumber(delaySeconds, 2)} s`;
  }

  if (delaySeconds < 60) {
    return `${formatNumber(delaySeconds, 1)} s`;
  }

  const minutes = Math.floor(delaySeconds / 60);
  const seconds = Math.round(delaySeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function getEarthDistanceDisplay(earthDistanceKm: number): {
  label: string;
  value: string;
  unit: string;
} {
  if (earthDistanceKm < 50_000) {
    return {
      label: 'Altitude',
      value: formatDistanceKm(Math.max(earthDistanceKm - EARTH_MEAN_RADIUS_KM, 0)),
      unit: 'km',
    };
  }

  return {
    label: 'Distance from Earth',
    value: formatDistanceKm(earthDistanceKm),
    unit: 'km',
  };
}

export function getRadialVelocity(position: MissionPosition, velocity: MissionVelocity): {
  value: string;
  unit: string;
  direction: string;
} {
  const magnitude = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);
  if (magnitude <= 0) {
    return {
      value: '0.00',
      unit: 'km/s',
      direction: 'Neutral',
    };
  }

  const radialVelocity = (
    position.x * velocity.x +
    position.y * velocity.y +
    position.z * velocity.z
  ) / magnitude;

  let direction = 'Neutral';
  if (radialVelocity > 0.05) direction = 'Outbound';
  if (radialVelocity < -0.05) direction = 'Inbound';

  return {
    value: `${radialVelocity >= 0 ? '+' : ''}${formatNumber(radialVelocity, 2)}`,
    unit: 'km/s',
    direction,
  };
}

export function formatEventETA(targetTimestamp: string, anchorTimestamp: string): string {
  const deltaMs = new Date(targetTimestamp).getTime() - new Date(anchorTimestamp).getTime();
  const absDeltaMs = Math.abs(deltaMs);
  const totalMinutes = Math.floor(absDeltaMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (totalMinutes === 0) {
    return 'now';
  }

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${String(hours).padStart(2, '0')}h`);
  parts.push(`${String(minutes).padStart(2, '0')}m`);

  return deltaMs >= 0 ? `in ${parts.join(' ')}` : `${parts.join(' ')} ago`;
}

export function formatSolarRange(solarRangeKm: number): string {
  if (solarRangeKm >= 1_000_000) {
    return `${formatNumber(solarRangeKm / 1_000_000, 1)}M km`;
  }

  return `${formatDistanceKm(solarRangeKm)} km`;
}

