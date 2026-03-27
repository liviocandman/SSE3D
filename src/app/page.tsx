import { getCachedBulkEphemeris } from '@/services/cacheService';
import { BODY_IDS, type EphemerisData } from '@/lib/types';
import { HomePage } from './HomePage';

// Main planet IDs to pre-fetch for background orbits
const CORE_PLANET_IDS = [
  BODY_IDS.MERCURY,
  BODY_IDS.VENUS,
  BODY_IDS.EARTH,
  BODY_IDS.MARS,
  BODY_IDS.JUPITER,
  BODY_IDS.SATURN,
  BODY_IDS.URANUS,
  BODY_IDS.NEPTUNE,
  BODY_IDS.PLUTO
];

/**
 * Server Component (Default Route)
 * Responsibile for pre-fetching orbit data from Redis to eliminate "pop-in".
 */
export default async function Page() {
  const currentDateStr = new Date().toISOString().split('T')[0];
  let initialOrbits: EphemerisData[] = [];
  let initialTrajectory: EphemerisData[] = [];

  try {
    // 1. Attempt to pull static full orbits
    const orbitRes = await getCachedBulkEphemeris(CORE_PLANET_IDS, 'FULL_ORBIT');
    if (orbitRes.cached.length > 0) {
      initialOrbits = orbitRes.cached;
      console.log(`[Server] Pre-fetched ${orbitRes.cached.length} full orbits.`);
    }

    // 2. Attempt to pull current 30-day window to prevent "Out-of-bounds" jump
    const trajectoryRes = await getCachedBulkEphemeris(CORE_PLANET_IDS, `${currentDateStr}_30`);
    if (trajectoryRes.cached.length > 0) {
      initialTrajectory = trajectoryRes.cached;
      console.log(`[Server] Pre-fetched ${trajectoryRes.cached.length} current trajectories.`);
    }
  } catch (error) {
    console.warn('[Server] Redis pre-fetch failed:', error);
  }

  // Pass all pre-fetched data to HomePage
  return <HomePage initialFullOrbits={initialOrbits} initialTrajectoryData={initialTrajectory} />;
}
