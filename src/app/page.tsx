import type { EphemerisData } from '@/lib/types';
import { HomePage } from './HomePage';

/**
 * Server Component (Default Route)
 * SPICE-backed ephemeris is generated on demand in the API layer,
 * so we skip Redis prefetch and let the client bootstrap normally.
 */
export default async function Page() {
  const initialOrbits: EphemerisData[] = [];
  const initialTrajectory: EphemerisData[] = [];

  return <HomePage initialFullOrbits={initialOrbits} initialTrajectoryData={initialTrajectory} />;
}
